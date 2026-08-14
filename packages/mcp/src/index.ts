export { McpModuleError } from "./mcp.errors.ts";
export type { McpModuleErrorCode } from "./mcp.errors.ts";
export {
	MCP_CATALOG_SCHEMAS_TOOL_NAME,
	MCP_CATALOG_SEARCH_TOOL_NAME,
} from "./mcp-catalog-exposure.ts";
export type {
	McpCatalogEagerExposure,
	McpCatalogExposureKind,
	McpCatalogExposurePolicy,
	McpCatalogExposureResolverInput,
	McpCatalogExposureStrategy,
	McpCatalogLazyExposure,
	McpCatalogNameSelector,
	McpCatalogPredicateSelector,
	McpCatalogReadonly,
	McpCatalogSchemasResult,
	McpCatalogSearchExposure,
	McpCatalogSearchResult,
	McpCatalogSearchResultTool,
	McpCatalogTagSelector,
	McpCatalogTool,
	McpCatalogToolSelector,
} from "./mcp-catalog-exposure.ts";
export { Prompt, Resource, Targets, Tool } from "./decorators/mcp-handler.decorators.ts";
export type {
	PromptMethodDecorator,
	PromptOptions,
	ResourceMethodDecorator,
	ResourceOptions,
	ToolMethodDecorator,
	ToolOptions,
} from "./decorators/mcp-handler.decorators.ts";
export { McpHttpController, McpHttpControllerFor } from "./mcp-http.controller.ts";
export type {
	McpHttpControllerClass,
	McpHttpControllerOptions,
	McpHttpHandlerFactory,
} from "./mcp-http.controller.ts";
export { McpModule } from "./mcp.module.ts";
export type { McpForRootAsyncOptions, McpForRootOptions } from "./mcp.module-definition.ts";
export { McpCapabilitiesService } from "./mcp-capabilities.service.ts";
export { McpRuntimeService } from "./mcp-runtime.service.ts";
export { createMcpHandlerPassthroughMiddleware } from "./mcp-handler.middleware.ts";
export type {
	McpCapabilityMutation,
	McpCapabilityDescriptor,
	McpCapabilityMutationKind,
	McpCapabilityMutationObserver,
	McpCapabilityMutationType,
	McpCapabilityVisibility,
	McpCapabilityVisibilityPolicy,
	McpDynamicHandlerRegistration,
} from "./mcp-capability.types.ts";
export type {
	McpHandlerAuthorizationPolicy,
	McpHandlerInvocationInput,
	McpHandlerInvocationOutput,
	McpHandlerInvocationOutputFor,
	McpHandlerInvocationOutputMap,
	McpHandlerLifecycleObserver,
	McpHandlerMiddleware,
	McpHandlerMiddlewareProvider,
	McpHandlerOperationContext,
	McpHandlerPassthroughMiddleware,
	McpModuleExtras,
	McpModuleOptions,
	McpNestCatalogExposureOptions,
	McpNestCollaborators,
	McpNestGatewayOptions,
	McpNestGatewayUpstream,
	McpNestGatewayUpstreamDefinition,
	McpNestServerDefinition,
	McpProviderToken,
	McpServerContributor,
	McpServerErrorReporter,
	McpServerLifecycleObserver,
	McpServerMiddlewareProvider,
	McpServerPrincipalClaimsProvider,
	McpServerRuntimeObserverProvider,
} from "./mcp.types.ts";

export { allowMcpOperation, denyMcpOperation } from "@nestm/mcp-core";
export type { McpAuthorizationDecision } from "@nestm/mcp-core";

export {
	acceptedContent,
	completable,
	createRequestStateCodec,
	fromJsonSchema,
	inputRequired,
	inputResponse,
	ResourceTemplate,
} from "@nestm/mcp-server";
export type {
	CacheHint,
	CallToolResult,
	CompletableSchema,
	CompleteCallback,
	CompleteResourceTemplateCallback,
	ElicitInputParams,
	GetPromptResult,
	Icon,
	InputRequiredSpec,
	InputRequiredResult,
	InputResponseView,
	McpServerBuildContext,
	McpServerMiddleware,
	McpServerPrincipal,
	McpServerPrincipalClaims,
	PromptCallback,
	ReadResourceCallback,
	ReadResourceResult,
	ReadResourceTemplateCallback,
	RequestStateCodec,
	RequestStateCodecOptions,
	ResourceMetadata,
	ServerContext,
	StandardSchemaWithJSON,
	ToolAnnotations,
	ToolCallback,
} from "@nestm/mcp-server";
