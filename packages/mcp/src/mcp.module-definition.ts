import { ConfigurableModuleBuilder } from "@nestjs/common";
import type { Provider } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { McpModuleError } from "./mcp.errors.ts";
import {
	McpProviderRegistry,
	McpProviderScopeGuard,
	type McpCollaboratorEntry,
	type McpRuntimeProviderToken,
	isMcpRuntimeProviderToken,
	mcpProviderTokenName,
} from "./mcp-provider.registry.ts";
import { MCP_MODULE_OPTIONS } from "./mcp.tokens.ts";
import type { McpModuleExtras, McpModuleOptions } from "./mcp.types.ts";

export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
	new ConfigurableModuleBuilder<McpModuleOptions>({
		optionsInjectionToken: MCP_MODULE_OPTIONS,
	})
		.setClassMethodName("forRoot")
		.setFactoryMethodName("createMcpOptions")
		.setExtras<McpModuleExtras>({ isGlobal: false, collaborators: {} }, (definition, extras) => {
			const collaboratorProviders = [...(extras.collaborators?.providers ?? [])];
			const entries = collaboratorEntries(collaboratorProviders);
			const aliasProviders = entries.map(({ alias, token }) => ({
				provide: alias,
				useExisting: token,
			}));
			const scopeGuardToken = Symbol("@nestm/mcp:collaborator-scope-guard");
			return {
				...definition,
				global: extras.isGlobal === true,
				imports: [...(definition.imports ?? []), ...(extras.collaborators?.imports ?? [])],
				providers: [
					...(definition.providers ?? []),
					...collaboratorProviders,
					...aliasProviders,
					{
						provide: McpProviderRegistry,
						inject: entries.map(({ alias }) => alias),
						useFactory: (...instances: unknown[]) =>
							new McpProviderRegistry(
								entries.map(({ token }, index) => [token, instances[index]] as const),
							),
					},
					{
						provide: scopeGuardToken,
						inject: [ModuleRef],
						useFactory: (moduleRef: ModuleRef) => new McpProviderScopeGuard(moduleRef, entries),
					},
				],
			};
		})
		.build();

export type McpForRootOptions = typeof OPTIONS_TYPE;
export type McpForRootAsyncOptions = typeof ASYNC_OPTIONS_TYPE;

function collaboratorEntries(providers: readonly Provider[]): readonly McpCollaboratorEntry[] {
	const seen = new Set<McpRuntimeProviderToken>();
	return providers.map((provider, index) => {
		const token = collaboratorProviderToken(provider);
		if (seen.has(token)) {
			throw new McpModuleError(
				"INVALID_OPTIONS",
				`MCP collaborators contain duplicate provider token ${mcpProviderTokenName(token)}.`,
			);
		}
		seen.add(token);
		return Object.freeze({
			alias: Symbol(`@nestm/mcp:collaborator:${String(index)}`),
			token,
		});
	});
}

function collaboratorProviderToken(provider: Provider): McpRuntimeProviderToken {
	const token =
		typeof provider === "function"
			? provider
			: typeof provider === "object" && provider !== null && "provide" in provider
				? provider.provide
				: undefined;
	if (!isMcpRuntimeProviderToken(token)) {
		throw new McpModuleError(
			"INVALID_OPTIONS",
			`MCP collaborator provider uses unsupported token ${mcpProviderTokenName(token)}.`,
		);
	}
	return token;
}
