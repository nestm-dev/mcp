"use client";

import { useMemo, useState } from "react";
import { Braces, ListTree } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  RAW_ARGUMENTS_ERROR_PATH,
  ROOT_ARGUMENTS_ERROR_PATH,
  MAX_ARGUMENT_JSON_BYTES,
  analyzeArgumentSchema,
  argumentIncludedName,
  argumentModeName,
  argumentRawName,
  argumentValueName,
  createDefaultArguments,
  type ArgumentFieldErrors,
  type ArgumentObjectNode,
  type ArgumentProperty,
  type ArgumentSchemaAnalysis,
  type ArgumentSchemaNode,
} from "@/lib/json-schema-arguments";
import { cn } from "@/lib/utils";

export interface JsonSchemaArgumentFormProps {
  readonly schema: unknown;
  readonly errors?: ArgumentFieldErrors;
  readonly prefix?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function JsonSchemaArgumentForm({
  schema,
  errors = {},
  prefix = "tool-arguments",
  disabled = false,
  className,
}: JsonSchemaArgumentFormProps) {
  const analysis = useMemo(() => analyzeArgumentSchema(schema), [schema]);
  const schemaKey = useMemo(() => getSchemaKey(schema), [schema]);
  return (
    <ArgumentFormContent
      analysis={analysis}
      className={className}
      disabled={disabled}
      errors={errors}
      key={schemaKey}
      prefix={prefix}
      schema={schema}
    />
  );
}

function ArgumentFormContent({
  schema,
  analysis,
  errors,
  prefix,
  disabled,
  className,
}: {
  readonly schema: unknown;
  readonly analysis: ArgumentSchemaAnalysis;
  readonly errors: ArgumentFieldErrors;
  readonly prefix: string;
  readonly disabled: boolean;
  readonly className?: string;
}) {
  const [preferredMode, setPreferredMode] = useState<"fields" | "raw">(
    analysis.supported ? "fields" : "raw",
  );
  const mode = analysis.supported ? preferredMode : "raw";
  const rawDefault = JSON.stringify(createDefaultArguments(schema), null, 2);

  return (
    <div className={cn("grid gap-4", className)}>
      <input name={argumentModeName(prefix)} type="hidden" value={mode} />

      {analysis.supported ? (
        <div
          className="flex w-fit rounded-lg border bg-muted/35 p-0.5"
          role="group"
          aria-label="Argument editor mode"
        >
          <Button
            aria-pressed={mode === "fields"}
            disabled={disabled}
            onClick={() => setPreferredMode("fields")}
            size="sm"
            type="button"
            variant={mode === "fields" ? "secondary" : "ghost"}
          >
            <ListTree />
            Form
          </Button>
          <Button
            aria-pressed={mode === "raw"}
            disabled={disabled}
            onClick={() => setPreferredMode("raw")}
            size="sm"
            type="button"
            variant={mode === "raw" ? "secondary" : "ghost"}
          >
            <Braces />
            Raw JSON
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-warning/30 bg-warning/7 p-3 text-xs leading-relaxed text-warning-foreground">
          <p className="font-medium">Raw JSON required</p>
          <p className="mt-1 opacity-85">{analysis.reason}</p>
        </div>
      )}

      {analysis.supported ? (
        <div hidden={mode !== "fields"}>
          {analysis.root.properties.length > 0 ? (
            <div className="grid gap-4">
              {analysis.root.properties.map((property) => (
                <SchemaPropertyField
                  disabled={disabled}
                  errors={errors}
                  key={property.node.path}
                  prefix={prefix}
                  property={property}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed bg-muted/20 p-5 text-center text-sm text-muted-foreground">
              This tool accepts an empty argument object.
            </div>
          )}
        </div>
      ) : null}

      {errors[ROOT_ARGUMENTS_ERROR_PATH] ? (
        <p className="text-xs text-destructive" role="alert">
          {errors[ROOT_ARGUMENTS_ERROR_PATH]}
        </p>
      ) : null}

      <div className="grid gap-2" hidden={mode !== "raw"}>
        <Label htmlFor={`${prefix}-raw-json`}>Arguments JSON</Label>
        <Textarea
          aria-describedby={`${prefix}-raw-json-hint${errors[RAW_ARGUMENTS_ERROR_PATH] ? ` ${prefix}-raw-json-error` : ""}`}
          aria-invalid={errors[RAW_ARGUMENTS_ERROR_PATH] !== undefined}
          className="min-h-48 font-mono text-xs leading-relaxed"
          defaultValue={rawDefault}
          disabled={disabled}
          id={`${prefix}-raw-json`}
          maxLength={MAX_ARGUMENT_JSON_BYTES}
          name={argumentRawName(prefix)}
          spellCheck={false}
        />
        {errors[RAW_ARGUMENTS_ERROR_PATH] ? (
          <p className="text-xs text-destructive" id={`${prefix}-raw-json-error`}>
            {errors[RAW_ARGUMENTS_ERROR_PATH]}
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-muted-foreground" id={`${prefix}-raw-json-hint`}>
          Provide one JSON object. It is parsed as data and is never evaluated as code.
        </p>
      </div>
    </div>
  );
}

function SchemaPropertyField({
  property,
  prefix,
  errors,
  disabled,
}: {
  readonly property: ArgumentProperty;
  readonly prefix: string;
  readonly errors: ArgumentFieldErrors;
  readonly disabled: boolean;
}) {
  const node = property.node;
  const initiallyIncluded = node.required || node.hasDefault || hasNestedDefaults(node);
  const [included, setIncluded] = useState(initiallyIncluded);
  const fieldDisabled = disabled || !included;
  const inputId = fieldId(prefix, node.path);
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const error = errors[node.path];

  return (
    <fieldset
      className={cn(
        "grid min-w-0 gap-2 rounded-xl border p-3",
        !included && "bg-muted/20 text-muted-foreground",
      )}
    >
      <legend className="sr-only">{node.title ?? property.name}</legend>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <Label className="min-w-0 truncate" htmlFor={inputId}>
          {node.title ?? property.name}
          {node.required ? <span className="ml-1 text-destructive">*</span> : null}
        </Label>
        {node.required ? (
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Required
          </span>
        ) : (
          <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <input
              checked={included}
              className="size-4 accent-[var(--primary)]"
              disabled={disabled}
              name={argumentIncludedName(node.path, prefix)}
              onChange={(event) => setIncluded(event.target.checked)}
              type="checkbox"
              value="true"
            />
            Include
          </label>
        )}
      </div>

      {node.kind === "object" ? (
        <ObjectFields disabled={fieldDisabled} errors={errors} node={node} prefix={prefix} />
      ) : (
        <PrimitiveField
          describedBy={`${hintId}${error ? ` ${errorId}` : ""}`}
          disabled={fieldDisabled}
          id={inputId}
          invalid={error !== undefined}
          node={node}
          prefix={prefix}
        />
      )}

      <FieldHint node={node} propertyName={property.name} id={hintId} />
      {error ? (
        <p className="text-xs text-destructive" id={errorId}>
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function ObjectFields({
  node,
  prefix,
  errors,
  disabled,
}: {
  readonly node: ArgumentObjectNode;
  readonly prefix: string;
  readonly errors: ArgumentFieldErrors;
  readonly disabled: boolean;
}) {
  if (node.properties.length === 0) {
    return <p className="text-xs text-muted-foreground">Empty object</p>;
  }
  return (
    <div className="grid gap-3 border-l pl-3">
      {node.properties.map((property) => (
        <SchemaPropertyField
          disabled={disabled}
          errors={errors}
          key={property.node.path}
          prefix={prefix}
          property={property}
        />
      ))}
    </div>
  );
}

function PrimitiveField({
  node,
  prefix,
  id,
  disabled,
  invalid,
  describedBy,
}: {
  readonly node: Exclude<ArgumentSchemaNode, ArgumentObjectNode>;
  readonly prefix: string;
  readonly id: string;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly describedBy: string;
}) {
  const common = {
    "aria-describedby": describedBy,
    "aria-invalid": invalid,
    "aria-required": node.required,
    disabled,
    id,
    name: argumentValueName(node.path, prefix),
  } as const;

  if (node.kind === "string" && node.enumValues) {
    return (
      <select
        {...common}
        className="h-9 w-full min-w-0 rounded-lg border border-transparent bg-input/50 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
        defaultValue={node.hasDefault ? String(node.defaultValue) : ""}
      >
        <option value="">Choose a value…</option>
        {node.enumValues.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    );
  }

  if (node.kind === "boolean") {
    return (
      <select
        {...common}
        className="h-9 w-full min-w-0 rounded-lg border border-transparent bg-input/50 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
        defaultValue={node.hasDefault ? String(node.defaultValue) : ""}
      >
        <option value="">Choose true or false…</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (node.kind === "array") {
    return (
      <Textarea
        {...common}
        className="min-h-28 font-mono text-xs leading-relaxed"
        defaultValue={node.hasDefault ? JSON.stringify(node.defaultValue, null, 2) : "[]"}
        spellCheck={false}
      />
    );
  }

  if (node.kind === "number" || node.kind === "integer") {
    return (
      <Input
        {...common}
        defaultValue={node.hasDefault ? String(node.defaultValue) : ""}
        max={node.maximum}
        min={node.minimum}
        step={node.kind === "integer" ? 1 : "any"}
        type="number"
      />
    );
  }

  if (node.kind === "string") {
    return (
      <Input
        {...common}
        defaultValue={node.hasDefault ? String(node.defaultValue) : ""}
        maxLength={node.maxLength}
        minLength={node.minLength}
        type={inputTypeForFormat(node.format)}
      />
    );
  }

  return null;
}

function FieldHint({
  node,
  propertyName,
  id,
}: {
  readonly node: ArgumentSchemaNode;
  readonly propertyName: string;
  readonly id: string;
}) {
  const constraints = constraintDescription(node);
  return (
    <p className="text-xs leading-relaxed text-muted-foreground" id={id}>
      {node.description ?? propertyName}
      {constraints ? ` · ${constraints}` : ""}
    </p>
  );
}

function constraintDescription(node: ArgumentSchemaNode): string | undefined {
  if (node.kind === "string") {
    const parts = [
      node.format ? `format: ${node.format}` : undefined,
      node.minLength !== undefined ? `min ${String(node.minLength)} chars` : undefined,
      node.maxLength !== undefined ? `max ${String(node.maxLength)} chars` : undefined,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : undefined;
  }
  if (node.kind === "number" || node.kind === "integer") {
    const parts = [
      node.kind === "integer" ? "whole number" : undefined,
      node.minimum !== undefined ? `min ${String(node.minimum)}` : undefined,
      node.maximum !== undefined ? `max ${String(node.maximum)}` : undefined,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : undefined;
  }
  if (node.kind === "array") {
    const parts = [
      "JSON array",
      node.minItems !== undefined ? `min ${String(node.minItems)} items` : undefined,
      node.maxItems !== undefined ? `max ${String(node.maxItems)} items` : undefined,
    ].filter(Boolean);
    return parts.join(", ");
  }
  return node.kind;
}

function hasNestedDefaults(node: ArgumentSchemaNode): boolean {
  return (
    node.kind === "object" &&
    node.properties.some((property) => property.node.hasDefault || hasNestedDefaults(property.node))
  );
}

function inputTypeForFormat(format: string | undefined): "text" | "email" | "url" | "date" {
  if (format === "email") return "email";
  if (format === "uri" || format === "url") return "url";
  if (format === "date") return "date";
  return "text";
}

function fieldId(prefix: string, path: string): string {
  return `${prefix}-field-${encodeURIComponent(path)}`;
}

function getSchemaKey(schema: unknown): string {
  try {
    return JSON.stringify(schema) ?? "undefined-schema";
  } catch {
    return "unserializable-schema";
  }
}
