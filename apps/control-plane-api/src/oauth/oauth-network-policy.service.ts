import { Inject, Injectable } from "@nestjs/common";
import type { FetchLike, OAuthDiscoveryState } from "@modelcontextprotocol/client";

import { ControlPlaneError } from "../common/control-plane.error.ts";
import { ControlPlaneConfigService } from "../config/control-plane-config.service.ts";
import { MCP_OAUTH_BASE_FETCH, type McpOAuthBaseFetch } from "./oauth.types.ts";

@Injectable()
export class OAuthNetworkPolicyService {
	readonly #allowedHosts: ReadonlySet<string>;

	constructor(
		@Inject(ControlPlaneConfigService) private readonly config: ControlPlaneConfigService,
		@Inject(MCP_OAUTH_BASE_FETCH) private readonly baseFetch: McpOAuthBaseFetch,
	) {
		this.#allowedHosts = new Set(
			(config.oauthAllowedHosts ?? config.allowedHosts).map(normalizeHostname),
		);
	}

	createFetch(
		resourceEndpoint: string,
		getDiscovery: () => OAuthDiscoveryState | undefined,
	): FetchLike {
		const resourceOrigin = new URL(resourceEndpoint).origin;
		return async (input, init) => {
			const requested = requestUrl(input);
			const method = requestMethod(input, init);
			this.#assertAllowed(requested, method, resourceOrigin, getDiscovery());
			const response = await this.baseFetch(input, {
				...init,
				redirect: "manual",
				signal: AbortSignal.any([
					AbortSignal.timeout(this.config.requestTimeoutMs),
					...(init?.signal == null ? [] : [init.signal]),
				]),
			});
			if (response.status >= 300 && response.status < 400) throw oauthEndpointRejectedError();
			return response;
		};
	}

	admitAuthorizationRedirect(
		authorizationUrl: string,
		discovery: OAuthDiscoveryState | undefined,
	): string {
		let redirect: URL;
		let exactEndpoint: URL;
		try {
			redirect = new URL(authorizationUrl);
			exactEndpoint = new URL(discovery?.authorizationServerMetadata?.authorization_endpoint ?? "");
		} catch {
			throw oauthEndpointRejectedError();
		}
		if (
			redirect.protocol !== "https:" ||
			redirect.username.length > 0 ||
			redirect.password.length > 0 ||
			redirect.hash.length > 0 ||
			!this.#allowedHosts.has(normalizeHostname(redirect.hostname)) ||
			redirect.origin !== exactEndpoint.origin ||
			redirect.pathname !== exactEndpoint.pathname
		) {
			throw oauthEndpointRejectedError();
		}
		return redirect.href;
	}

	#assertAllowed(
		endpoint: URL,
		method: string,
		resourceOrigin: string,
		discovery: OAuthDiscoveryState | undefined,
	): void {
		if (
			endpoint.protocol !== "https:" ||
			endpoint.username.length > 0 ||
			endpoint.password.length > 0 ||
			endpoint.hash.length > 0
		) {
			throw oauthEndpointRejectedError();
		}
		const hostname = normalizeHostname(endpoint.hostname);
		if (method === "GET") {
			if (endpoint.origin === resourceOrigin || this.#allowedHosts.has(hostname)) return;
			throw oauthEndpointRejectedError();
		}
		if (method !== "POST" || !this.#allowedHosts.has(hostname) || discovery === undefined) {
			throw oauthEndpointRejectedError();
		}
		const metadata = discovery.authorizationServerMetadata;
		const exactCredentialEndpoints = [metadata?.registration_endpoint, metadata?.token_endpoint]
			.filter((value): value is string => typeof value === "string")
			.map((value) => new URL(value).href);
		if (!exactCredentialEndpoints.includes(endpoint.href)) throw oauthEndpointRejectedError();
	}
}

function requestUrl(input: Parameters<FetchLike>[0]): URL {
	if (input instanceof Request) return new URL(input.url);
	return new URL(String(input));
}

function requestMethod(input: Parameters<FetchLike>[0], init: RequestInit | undefined): string {
	return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

function normalizeHostname(value: string): string {
	const lower = value.trim().toLowerCase();
	return lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
}

function oauthEndpointRejectedError(): ControlPlaneError {
	return new ControlPlaneError(
		"MCP_OAUTH_ENDPOINT_REJECTED",
		422,
		"An OAuth endpoint is not admitted by this control plane.",
	);
}
