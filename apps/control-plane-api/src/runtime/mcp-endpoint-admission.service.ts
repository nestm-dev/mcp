import { Inject, Injectable } from "@nestjs/common";
import type { FetchLike } from "@modelcontextprotocol/client";

import { ControlPlaneError } from "../common/control-plane.error.ts";
import { ControlPlaneConfigService } from "../config/control-plane-config.service.ts";
import { MCP_CONTROL_PLANE_BASE_FETCH, type McpBaseFetch } from "./runtime.types.ts";

export interface AdmittedHttpEndpoint {
	readonly url: string;
	readonly host: string;
}

@Injectable()
export class McpEndpointAdmissionService {
	readonly #allowedHosts: ReadonlySet<string>;

	constructor(
		@Inject(ControlPlaneConfigService) private readonly config: ControlPlaneConfigService,
		@Inject(MCP_CONTROL_PLANE_BASE_FETCH) private readonly baseFetch: McpBaseFetch,
	) {
		this.#allowedHosts = new Set(config.allowedHosts.map(normalizeHostname));
	}

	admit(rawEndpoint: string): AdmittedHttpEndpoint {
		let endpoint: URL;
		try {
			endpoint = new URL(rawEndpoint);
		} catch (cause) {
			throw endpointRejectedError(cause);
		}
		this.#assertAllowed(endpoint);
		return Object.freeze({ url: endpoint.href, host: endpoint.host });
	}

	createFetch(admittedEndpoint: string): FetchLike {
		const admittedOrigin = new URL(admittedEndpoint).origin;
		return async (input, init) => {
			const requested = requestUrl(input);
			this.#assertAllowed(requested);
			if (requested.origin !== admittedOrigin) throw endpointRejectedError();
			const response = await this.baseFetch(input, { ...init, redirect: "manual" });
			if (response.status >= 300 && response.status < 400) throw endpointRejectedError();
			return response;
		};
	}

	#assertAllowed(endpoint: URL): void {
		if (
			endpoint.username.length > 0 ||
			endpoint.password.length > 0 ||
			endpoint.search.length > 0 ||
			endpoint.hash.length > 0
		) {
			throw endpointRejectedError();
		}
		const hostname = normalizeHostname(endpoint.hostname);
		if (!this.#allowedHosts.has(hostname)) throw endpointRejectedError();
		if (endpoint.protocol === "https:") return;
		if (
			endpoint.protocol === "http:" &&
			this.config.allowLoopbackHttp &&
			isLoopbackHostname(hostname)
		) {
			return;
		}
		throw endpointRejectedError();
	}
}

function requestUrl(input: Parameters<FetchLike>[0]): URL {
	if (input instanceof Request) return new URL(input.url);
	return new URL(String(input));
}

function normalizeHostname(value: string): string {
	const lower = value.trim().toLowerCase();
	return lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
}

function isLoopbackHostname(value: string): boolean {
	return value === "127.0.0.1" || value === "localhost" || value === "::1";
}

function endpointRejectedError(cause?: unknown): ControlPlaneError {
	return new ControlPlaneError(
		"MCP_ENDPOINT_REJECTED",
		422,
		"The MCP endpoint is not admitted by this control plane.",
		cause === undefined ? undefined : { cause },
	);
}
