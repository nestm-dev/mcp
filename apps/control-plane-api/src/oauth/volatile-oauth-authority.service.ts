import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type {
	AuthProvider,
	FetchLike,
	OAuthClientInformationContext,
} from "@modelcontextprotocol/client";
import { auth, refreshAuthorization } from "@nestm/mcp-client";
import {
	createOAuthStateLookupDigest,
	parseOAuthCallbackParameters,
	validateOAuthState,
	type McpOAuthCallbackParameters,
} from "@nestm/mcp-client/oauth";

import { ControlPlaneError } from "../common/control-plane.error.ts";
import { ControlPlaneConfigService } from "../config/control-plane-config.service.ts";
import { OAuthNetworkPolicyService } from "./oauth-network-policy.service.ts";
import type { OAuthConnectionView, OAuthRuntimeBridgeLease } from "./oauth.types.ts";
import { VolatileOAuthProvider } from "./volatile-oauth-provider.ts";

interface PendingAuthorization {
	readonly connectionId: string;
	readonly generationKey: string;
	readonly endpoint: string;
	readonly stateDigest: string;
	readonly createdAtMs: number;
	readonly provider: VolatileOAuthProvider;
	readonly fetch: FetchLike;
}

export interface PreparedOAuthAuthorization {
	readonly connectionId: string;
	readonly generationKey: string;
	readonly endpoint: string;
	readonly provider: VolatileOAuthProvider;
	readonly fetch: FetchLike;
}

interface SafeAuthorizationState {
	readonly status: OAuthConnectionView["status"];
	readonly scopes: readonly string[];
	readonly authorizationServerHost?: string;
	readonly errorCode?: string;
}

export interface TakenOAuthCallback {
	readonly attempt: PendingAuthorization;
	readonly callback: McpOAuthCallbackParameters;
}

@Injectable()
export class VolatileOAuthAuthorityService implements OnApplicationShutdown {
	readonly #pendingByConnection = new Map<string, PendingAuthorization>();
	readonly #pendingByStateDigest = new Map<string, PendingAuthorization>();
	readonly #activeByGeneration = new Map<string, PreparedOAuthAuthorization>();
	readonly #bridges = new Map<string, Set<RuntimeAuthBridge>>();
	readonly #refreshes = new Map<string, Promise<void>>();
	readonly #states = new Map<string, SafeAuthorizationState>();

	constructor(
		private readonly config: ControlPlaneConfigService,
		private readonly network: OAuthNetworkPolicyService,
	) {}

	registerConnection(connectionId: string): void {
		if (this.#states.has(connectionId)) return;
		this.#states.set(connectionId, authorizationRequiredState());
	}

	isAuthorized(generationKey: string): boolean {
		const active = this.#activeByGeneration.get(generationKey);
		return (
			active !== undefined &&
			this.#states.get(active.connectionId)?.status === "authorized" &&
			active.provider.currentAccessToken() !== undefined
		);
	}

	view(connectionId: string, generationKey: string): OAuthConnectionView {
		const state = this.#states.get(connectionId) ?? authorizationRequiredState();
		const active = this.#activeByGeneration.get(generationKey);
		const effective =
			active === undefined || state.status !== "authorized"
				? state
				: safeState("authorized", active.provider);
		return Object.freeze({
			kind: "oauth" as const,
			status: effective.status,
			scopes: Object.freeze([...effective.scopes]),
			...(effective.authorizationServerHost === undefined
				? {}
				: { authorizationServerHost: effective.authorizationServerHost }),
			...(effective.errorCode === undefined ? {} : { errorCode: effective.errorCode }),
		});
	}

	async beginAuthorization(input: {
		readonly connectionId: string;
		readonly generationKey: string;
		readonly endpoint: string;
	}): Promise<string> {
		this.cancelPending(input.connectionId, false);
		this.#states.set(input.connectionId, authorizingState());
		const provider = new VolatileOAuthProvider({
			redirectUrl:
				this.config.oauthCallbackUrl ?? "http://127.0.0.1:5173/api/v1/mcp/oauth/callback",
			clientName: "NestM local MCP manager",
		});
		const guardedFetch = this.network.createFetch(input.endpoint, () => provider.discoveryState());
		try {
			const result = await auth(provider, {
				serverUrl: input.endpoint,
				fetchFn: guardedFetch,
			});
			if (result !== "REDIRECT") throw oauthUpstreamFailedError();
			const redirect = provider.takeAuthorizationRedirect();
			const authorizationUrl = this.network.admitAuthorizationRedirect(
				redirect.authorizationUrl,
				provider.discoveryState(),
			);
			const attempt = Object.freeze({
				...input,
				stateDigest: redirect.stateDigest,
				createdAtMs: redirect.createdAtMs,
				provider,
				fetch: guardedFetch,
			});
			this.#pendingByConnection.set(input.connectionId, attempt);
			this.#pendingByStateDigest.set(attempt.stateDigest, attempt);
			this.#states.set(input.connectionId, safeState("authorizing", provider));
			return authorizationUrl;
		} catch (error) {
			provider.invalidateCredentials("all");
			const mapped = mapOAuthFailure(error);
			this.#states.set(input.connectionId, failedState(mapped.code));
			throw mapped;
		}
	}

	takeCallback(parameters: URLSearchParams): TakenOAuthCallback {
		let callback: McpOAuthCallbackParameters;
		try {
			callback = parseOAuthCallbackParameters(parameters);
		} catch {
			throw oauthCallbackInvalidError();
		}
		let stateDigest: string;
		try {
			stateDigest = createOAuthStateLookupDigest(callback.state);
		} catch {
			throw oauthCallbackInvalidError();
		}
		const attempt = this.#pendingByStateDigest.get(stateDigest);
		if (attempt === undefined) throw oauthCallbackInvalidError();
		this.#pendingByStateDigest.delete(stateDigest);
		if (this.#pendingByConnection.get(attempt.connectionId) === attempt) {
			this.#pendingByConnection.delete(attempt.connectionId);
		}
		try {
			validateOAuthState({
				actualState: callback.state,
				expectedDigest: attempt.stateDigest,
				createdAtMs: attempt.createdAtMs,
				ttlMs: this.config.oauthTransactionTtlMs ?? 10 * 60 * 1_000,
			});
		} catch {
			attempt.provider.invalidateCredentials("all");
			this.#states.set(attempt.connectionId, failedState("MCP_OAUTH_CALLBACK_INVALID"));
			throw oauthCallbackInvalidError();
		}
		return Object.freeze({ attempt, callback });
	}

	discardTaken(taken: TakenOAuthCallback, errorCode: string): void {
		taken.attempt.provider.invalidateCredentials("all");
		this.#states.set(taken.attempt.connectionId, failedState(errorCode));
	}

	async exchangeCallback(taken: TakenOAuthCallback): Promise<PreparedOAuthAuthorization> {
		const { attempt, callback } = taken;
		if (callback.kind === "error") {
			attempt.provider.invalidateCredentials("all");
			this.#states.set(attempt.connectionId, failedState("MCP_OAUTH_AUTHORIZATION_DENIED"));
			throw oauthAuthorizationDeniedError();
		}
		try {
			const result = await auth(attempt.provider, {
				serverUrl: attempt.endpoint,
				authorizationCode: callback.code,
				...(callback.issuer === undefined ? {} : { iss: callback.issuer }),
				fetchFn: attempt.fetch,
			});
			if (result !== "AUTHORIZED" || attempt.provider.currentAccessToken() === undefined) {
				throw oauthUpstreamFailedError();
			}
			return Object.freeze({
				connectionId: attempt.connectionId,
				generationKey: attempt.generationKey,
				endpoint: attempt.endpoint,
				provider: attempt.provider,
				fetch: attempt.fetch,
			});
		} catch (error) {
			attempt.provider.invalidateCredentials("all");
			const mapped = mapOAuthFailure(error);
			this.#states.set(attempt.connectionId, failedState(mapped.code));
			throw mapped;
		}
	}

	publishAuthorization(active: PreparedOAuthAuthorization, generationKey: string): void {
		active.provider.clearAuthorizationTransaction();
		const published = Object.freeze({ ...active, generationKey });
		this.#activeByGeneration.set(generationKey, published);
		this.#states.set(active.connectionId, safeState("authorized", active.provider));
	}

	discardPrepared(active: PreparedOAuthAuthorization): void {
		active.provider.invalidateCredentials("all");
		this.#states.set(active.connectionId, failedState("MCP_OAUTH_UPSTREAM_FAILED"));
	}

	acquireRuntimeBridge(generationKey: string): OAuthRuntimeBridgeLease {
		const active = this.#activeByGeneration.get(generationKey);
		if (active === undefined || !this.isAuthorized(generationKey)) {
			throw oauthAuthorizationRequiredError();
		}
		const bridge = new RuntimeAuthBridge(
			() => active.provider.currentAccessToken(),
			async () => this.#refresh(generationKey),
			() => this.#bridges.get(generationKey)?.delete(bridge),
		);
		let bridges = this.#bridges.get(generationKey);
		if (bridges === undefined) {
			bridges = new Set();
			this.#bridges.set(generationKey, bridges);
		}
		bridges.add(bridge);
		return Object.freeze({ authProvider: bridge, close: async () => bridge.close() });
	}

	cancelPending(connectionId: string, resetState = true): void {
		const pending = this.#pendingByConnection.get(connectionId);
		if (pending !== undefined) {
			this.#pendingByConnection.delete(connectionId);
			this.#pendingByStateDigest.delete(pending.stateDigest);
			pending.provider.invalidateCredentials("all");
		}
		if (resetState) this.#states.set(connectionId, authorizationRequiredState());
	}

	fenceGeneration(generationKey: string): void {
		for (const bridge of this.#bridges.get(generationKey) ?? []) bridge.fence();
		this.#bridges.delete(generationKey);
		this.#refreshes.delete(generationKey);
		const active = this.#activeByGeneration.get(generationKey);
		this.#activeByGeneration.delete(generationKey);
		active?.provider.invalidateCredentials("all");
	}

	resetConnection(connectionId: string, generationKey: string): void {
		this.cancelPending(connectionId, false);
		this.fenceGeneration(generationKey);
		this.#states.set(connectionId, authorizationRequiredState());
	}

	removeConnection(connectionId: string, generationKey: string): void {
		this.cancelPending(connectionId, false);
		this.fenceGeneration(generationKey);
		this.#states.delete(connectionId);
	}

	onApplicationShutdown(): void {
		for (const connectionId of this.#pendingByConnection.keys()) {
			this.cancelPending(connectionId, false);
		}
		for (const generationKey of this.#activeByGeneration.keys()) {
			this.fenceGeneration(generationKey);
		}
		this.#states.clear();
	}

	#refresh(generationKey: string): Promise<void> {
		let task = this.#refreshes.get(generationKey);
		if (task !== undefined) return task;
		task = this.#performRefresh(generationKey);
		this.#refreshes.set(generationKey, task);
		void task.then(
			() => this.#deleteRefresh(generationKey, task),
			() => this.#deleteRefresh(generationKey, task),
		);
		return task;
	}

	async #performRefresh(generationKey: string): Promise<void> {
		const active = this.#activeByGeneration.get(generationKey);
		if (active === undefined) throw oauthAuthorizationRequiredError();
		const discovery = active.provider.discoveryState();
		const issuer = active.provider.issuer();
		const refreshToken = active.provider.currentRefreshToken();
		const clientInformation =
			issuer === undefined
				? undefined
				: active.provider.clientInformation({ issuer } satisfies OAuthClientInformationContext);
		if (
			discovery === undefined ||
			issuer === undefined ||
			refreshToken === undefined ||
			clientInformation === undefined
		) {
			this.#requireReauthorization(generationKey, active);
			throw oauthAuthorizationRequiredError();
		}
		try {
			const tokens = await refreshAuthorization(discovery.authorizationServerUrl, {
				...(discovery.authorizationServerMetadata === undefined
					? {}
					: { metadata: discovery.authorizationServerMetadata }),
				clientInformation,
				refreshToken,
				...(active.provider.resourceUrl() === undefined
					? {}
					: { resource: new URL(active.provider.resourceUrl()!) }),
				fetchFn: active.fetch,
			});
			if (this.#activeByGeneration.get(generationKey) !== active) {
				throw oauthAuthorizationRequiredError();
			}
			active.provider.saveTokens({ ...tokens, issuer }, { issuer });
			this.#states.set(active.connectionId, safeState("authorized", active.provider));
		} catch {
			if (this.#activeByGeneration.get(generationKey) === active) {
				this.#requireReauthorization(generationKey, active);
			}
			throw oauthAuthorizationRequiredError();
		}
	}

	#requireReauthorization(generationKey: string, active: PreparedOAuthAuthorization): void {
		const state = reauthorizationRequiredState(active.provider);
		this.fenceGeneration(generationKey);
		this.#states.set(active.connectionId, state);
	}

	#deleteRefresh(generationKey: string, task: Promise<void>): void {
		if (this.#refreshes.get(generationKey) === task) this.#refreshes.delete(generationKey);
	}
}

class RuntimeAuthBridge implements AuthProvider {
	#closed = false;

	constructor(
		private readonly readToken: () => string | undefined,
		private readonly refresh: () => Promise<void>,
		private readonly onClose: () => void,
	) {}

	async token(): Promise<string | undefined> {
		if (this.#closed) throw oauthAuthorizationRequiredError();
		return this.readToken();
	}

	async onUnauthorized(): Promise<void> {
		if (this.#closed) throw oauthAuthorizationRequiredError();
		await this.refresh();
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.onClose();
	}

	fence(): void {
		this.close();
	}
}

function safeState(
	status: OAuthConnectionView["status"],
	provider: VolatileOAuthProvider,
): SafeAuthorizationState {
	const discovery = provider.discoveryState();
	const scopeValues =
		(status === "authorized" ? provider.currentGrantedScopes() : undefined) ??
		discovery?.resourceMetadata?.scopes_supported ??
		discovery?.authorizationServerMetadata?.scopes_supported ??
		[];
	const scopes = Object.freeze(
		scopeValues
			.filter((scope): scope is string => typeof scope === "string")
			.slice(0, 64)
			.map((scope) => scope.slice(0, 256)),
	);
	const issuer =
		discovery?.authorizationServerMetadata?.issuer ?? discovery?.authorizationServerUrl;
	let authorizationServerHost: string | undefined;
	try {
		authorizationServerHost = issuer === undefined ? undefined : new URL(issuer).host;
	} catch {
		authorizationServerHost = undefined;
	}
	return Object.freeze({
		status,
		scopes,
		...(authorizationServerHost === undefined ? {} : { authorizationServerHost }),
	});
}

function authorizationRequiredState(): SafeAuthorizationState {
	return Object.freeze({ status: "authorization-required", scopes: Object.freeze([]) });
}

function authorizingState(): SafeAuthorizationState {
	return Object.freeze({ status: "authorizing", scopes: Object.freeze([]) });
}

function reauthorizationRequiredState(provider: VolatileOAuthProvider): SafeAuthorizationState {
	return Object.freeze({
		...safeState("reauthorization-required", provider),
		errorCode: "MCP_OAUTH_AUTHORIZATION_REQUIRED",
	});
}

function failedState(errorCode: string): SafeAuthorizationState {
	return Object.freeze({ status: "failed", scopes: Object.freeze([]), errorCode });
}

function mapOAuthFailure(error: unknown): ControlPlaneError {
	if (error instanceof ControlPlaneError) return error;
	return oauthUpstreamFailedError();
}

function oauthAuthorizationRequiredError(): ControlPlaneError {
	return new ControlPlaneError(
		"MCP_OAUTH_AUTHORIZATION_REQUIRED",
		409,
		"The MCP connection requires OAuth authorization.",
	);
}

function oauthAuthorizationDeniedError(): ControlPlaneError {
	return new ControlPlaneError(
		"MCP_OAUTH_AUTHORIZATION_DENIED",
		403,
		"OAuth authorization was denied.",
	);
}

function oauthCallbackInvalidError(): ControlPlaneError {
	return new ControlPlaneError(
		"MCP_OAUTH_CALLBACK_INVALID",
		400,
		"The OAuth callback is invalid or no longer active.",
	);
}

function oauthUpstreamFailedError(): ControlPlaneError {
	return new ControlPlaneError(
		"MCP_OAUTH_UPSTREAM_FAILED",
		502,
		"The OAuth authorization server could not complete the request.",
	);
}
