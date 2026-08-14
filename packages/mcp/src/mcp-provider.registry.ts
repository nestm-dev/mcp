import { Scope, type OnApplicationBootstrap } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { McpModuleError } from "./mcp.errors.ts";

export type McpRuntimeProviderToken = string | symbol | Function;

export interface McpCollaboratorEntry {
	readonly alias: symbol;
	readonly token: McpRuntimeProviderToken;
}

/** Module-local snapshot of collaborators resolved by Nest through explicit aliases. */
export class McpProviderRegistry {
	readonly #providers: ReadonlyMap<McpRuntimeProviderToken, unknown>;

	constructor(entries: readonly (readonly [McpRuntimeProviderToken, unknown])[]) {
		this.#providers = new Map(entries);
	}

	get(token: unknown): unknown {
		return isMcpRuntimeProviderToken(token) ? this.#providers.get(token) : undefined;
	}
}

/** Fails bootstrap when a configured collaborator has a non-static dependency tree. */
export class McpProviderScopeGuard implements OnApplicationBootstrap {
	constructor(
		private readonly moduleRef: ModuleRef,
		private readonly entries: readonly McpCollaboratorEntry[],
	) {}

	onApplicationBootstrap(): void {
		for (const { alias, token } of this.entries) {
			if (this.moduleRef.introspect(alias).scope === Scope.DEFAULT) continue;
			throw new McpModuleError(
				"INVALID_SCOPE",
				`MCP collaborator ${mcpProviderTokenName(token)} must use the default singleton scope with a static dependency tree.`,
			);
		}
	}
}

export function isMcpRuntimeProviderToken(value: unknown): value is McpRuntimeProviderToken {
	return typeof value === "string" || typeof value === "symbol" || typeof value === "function";
}

export function mcpProviderTokenName(token: unknown): string {
	if (typeof token === "string") return JSON.stringify(token);
	if (typeof token === "symbol") return token.description ?? token.toString();
	if (typeof token === "function") return token.name || "<anonymous>";
	return `<invalid ${token === null ? "null" : typeof token}>`;
}
