import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createApplication } from "../src/bootstrap.ts";

const componentSchema = z
	.object({
		properties: z.record(z.string(), z.unknown()),
		required: z.array(z.string()).optional(),
	})
	.passthrough();

const documentSchema = z
	.object({
		components: z.object({ schemas: z.record(z.string(), componentSchema) }),
		paths: z.record(z.string(), z.unknown()),
	})
	.passthrough();

const requestOperationSchema = z.object({
	requestBody: z.object({
		content: z.object({
			"application/json": z.object({ schema: componentSchema }),
		}),
	}),
});

const queryParameterSchema = z.object({
	in: z.string(),
	name: z.string(),
	required: z.boolean(),
	schema: z
		.object({
			maximum: z.number().optional(),
			minimum: z.number().optional(),
			type: z.string(),
		})
		.passthrough(),
});

const queryOperationSchema = z.object({ parameters: z.array(queryParameterSchema) });

describe("control-plane OpenAPI document", () => {
	it("publishes request and response contracts instead of empty DTO schemas", async () => {
		const app = await createApplication({ logger: false });
		try {
			const response = await app.inject({ method: "GET", url: "/openapi.json" });
			expect(response.statusCode).toBe(200);
			const document = documentSchema.parse(response.json<unknown>());

			const create = requestOperationSchema.parse(
				z.object({ post: requestOperationSchema }).parse(document.paths["/v1/mcp/connections"])
					.post,
			).requestBody.content["application/json"].schema;
			expect(Object.keys(create.properties)).toEqual([
				"displayName",
				"endpoint",
				"desiredState",
				"authentication",
			]);
			expect(create.required).toEqual(["displayName", "endpoint"]);
			expect(create).toMatchObject({ additionalProperties: false });
			expect(create.properties.endpoint).toMatchObject({
				example: "http://127.0.0.1:3200/mcp",
				format: "uri",
			});
			expect(create.properties.desiredState).toMatchObject({ default: "offline" });
			expect(create.properties.authentication).toMatchObject({ default: { kind: "none" } });

			const replace = z
				.object({ put: requestOperationSchema })
				.parse(document.paths["/v1/mcp/connections/{connectionId}"]).put.requestBody.content[
				"application/json"
			].schema;
			expect(replace.required).toEqual(["expectedRevision", "displayName"]);
			expect(replace.properties.endpoint).toMatchObject({
				description: "Omit to preserve the currently admitted endpoint and runtime generation.",
			});

			const catalogOperation = z
				.object({ get: queryOperationSchema })
				.parse(document.paths["/v1/mcp/hub/catalog"]).get;
			const catalogRevisionParameters = catalogOperation.parameters.filter(
				(parameter) => parameter.in === "query" && parameter.name === "expectedHubRevision",
			);
			expect(catalogRevisionParameters).toHaveLength(1);
			expect(catalogRevisionParameters[0]).toEqual({
				in: "query",
				name: "expectedHubRevision",
				required: false,
				schema: expect.objectContaining({
					maximum: Number.MAX_SAFE_INTEGER,
					minimum: 1,
					type: "integer",
				}),
			});

			const detachOperation = z
				.object({ delete: queryOperationSchema })
				.parse(document.paths["/v1/mcp/hub/members/{connectionId}"]).delete;
			for (const name of ["expectedHubRevision", "runtimeGeneration"] as const) {
				const matchingParameters = detachOperation.parameters.filter(
					(parameter) => parameter.in === "query" && parameter.name === name,
				);
				expect(matchingParameters).toHaveLength(1);
				expect(matchingParameters[0]).toEqual({
					in: "query",
					name,
					required: true,
					schema: expect.objectContaining({
						maximum: Number.MAX_SAFE_INTEGER,
						minimum: 1,
						type: "integer",
					}),
				});
			}

			const promptRequest = z
				.object({ post: requestOperationSchema })
				.parse(document.paths["/v1/mcp/connections/{connectionId}/prompts/get"]).post.requestBody
				.content["application/json"].schema;
			expect(promptRequest.properties.arguments).toMatchObject({
				maxProperties: 64,
			});

			const connection = document.components.schemas.ConnectionResponseDto;
			expect(connection?.properties).toHaveProperty("runtime");
			expect(connection?.properties).not.toHaveProperty("endpoint");

			const connectionsPath = JSON.stringify(document.paths["/v1/mcp/connections"]);
			expect(connectionsPath).toContain('"additionalProperties":false');
			expect(connectionsPath).toContain("#/components/schemas/ConnectionResponseDto");
		} finally {
			await app.close();
		}
	});
});
