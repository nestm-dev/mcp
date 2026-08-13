import { SetMetadata } from "@nestjs/common";
import type {
	CacheHint,
	Icon,
	PromptCallback,
	ReadResourceCallback,
	ReadResourceTemplateCallback,
	ResourceMetadata,
	ResourceTemplate,
	StandardSchemaWithJSON,
	ToolAnnotations,
	ToolCallback,
} from "@nestm/mcp-server";
import { MCP_HANDLER_METADATA } from "../mcp.tokens.ts";

interface McpHandlerTarget {
	/** Runtime names receiving this handler. Omit for every configured server. */
	readonly servers?: string | readonly string[];
}

export interface McpToolOptions<
	InputSchema extends StandardSchemaWithJSON | undefined = StandardSchemaWithJSON | undefined,
> extends McpHandlerTarget {
	readonly name: string;
	readonly title?: string;
	readonly description?: string;
	readonly inputSchema?: InputSchema;
	readonly outputSchema?: StandardSchemaWithJSON;
	readonly annotations?: ToolAnnotations;
	readonly icons?: Icon[];
	readonly _meta?: Record<string, unknown>;
}

export interface McpResourceOptions<
	Uri extends string | ResourceTemplate = string | ResourceTemplate,
> extends McpHandlerTarget {
	readonly name: string;
	readonly uri: Uri;
	readonly title?: string;
	readonly description?: string;
	readonly mimeType?: string;
	readonly size?: number;
	readonly icons?: Icon[];
	readonly annotations?: ResourceMetadata["annotations"];
	readonly _meta?: Record<string, unknown>;
	readonly cacheHint?: CacheHint;
}

export interface McpPromptOptions<
	ArgsSchema extends StandardSchemaWithJSON | undefined = StandardSchemaWithJSON | undefined,
> extends McpHandlerTarget {
	readonly name: string;
	readonly title?: string;
	readonly description?: string;
	readonly argsSchema?: ArgsSchema;
	readonly icons?: Icon[];
	readonly _meta?: Record<string, unknown>;
}

export interface McpToolHandlerDefinition {
	readonly kind: "tool";
	readonly options: McpToolOptions;
}

export interface McpResourceHandlerDefinition {
	readonly kind: "resource";
	readonly options: McpResourceOptions;
}

export interface McpPromptHandlerDefinition {
	readonly kind: "prompt";
	readonly options: McpPromptOptions;
}

export type McpHandlerDefinition =
	McpToolHandlerDefinition | McpResourceHandlerDefinition | McpPromptHandlerDefinition;

/** Legacy-decorator signature that checks the decorated method without replacing it. */
export type McpTypedMethodDecorator<ExpectedHandler> = <Handler extends ExpectedHandler>(
	target: object,
	propertyKey: string | symbol,
	descriptor: TypedPropertyDescriptor<Handler>,
) => void;

export type McpToolMethodDecorator<InputSchema extends StandardSchemaWithJSON | undefined> =
	McpTypedMethodDecorator<ToolCallback<InputSchema>>;

export type McpPromptMethodDecorator<ArgsSchema extends StandardSchemaWithJSON | undefined> =
	McpTypedMethodDecorator<PromptCallback<ArgsSchema>>;

export type McpResourceMethodDecorator<Uri extends string | ResourceTemplate> =
	McpTypedMethodDecorator<Uri extends string ? ReadResourceCallback : ReadResourceTemplateCallback>;

export function McpTool<const InputSchema extends StandardSchemaWithJSON | undefined = undefined>(
	options: McpToolOptions<InputSchema>,
): McpToolMethodDecorator<InputSchema> {
	return typedMetadataDecorator(freezeToolDefinition(options));
}

export function McpResource<const Uri extends string | ResourceTemplate>(
	options: McpResourceOptions<Uri>,
): McpResourceMethodDecorator<Uri> {
	return typedMetadataDecorator(freezeResourceDefinition(options));
}

export function McpPrompt<const ArgsSchema extends StandardSchemaWithJSON | undefined = undefined>(
	options: McpPromptOptions<ArgsSchema>,
): McpPromptMethodDecorator<ArgsSchema> {
	return typedMetadataDecorator(freezePromptDefinition(options));
}

function typedMetadataDecorator<Handler>(
	definition: McpHandlerDefinition,
): McpTypedMethodDecorator<Handler> {
	const decorator = SetMetadata(MCP_HANDLER_METADATA, definition);
	return (target, propertyKey, descriptor) => {
		decorator(target, propertyKey, descriptor);
	};
}

function freezeToolDefinition(options: McpToolOptions): McpToolHandlerDefinition {
	return Object.freeze({ kind: "tool", options: freezeOptions(options) });
}

function freezeResourceDefinition(options: McpResourceOptions): McpResourceHandlerDefinition {
	return Object.freeze({ kind: "resource", options: freezeOptions(options) });
}

function freezePromptDefinition(options: McpPromptOptions): McpPromptHandlerDefinition {
	return Object.freeze({ kind: "prompt", options: freezeOptions(options) });
}

function freezeOptions<Options extends McpHandlerTarget>(options: Options): Options {
	return Object.freeze({
		...options,
		...(Array.isArray(options.servers) ? { servers: Object.freeze([...options.servers]) } : {}),
	});
}
