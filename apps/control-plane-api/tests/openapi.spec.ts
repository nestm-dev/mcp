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

describe("control-plane OpenAPI document", () => {
	it("publishes request and response contracts instead of empty DTO schemas", async () => {
		const app = await createApplication({ logger: false });
		try {
			const response = await app.inject({ method: "GET", url: "/openapi.json" });
			expect(response.statusCode).toBe(200);
			const document = documentSchema.parse(response.json<unknown>());

			const create = document.components.schemas.CreateConnectionDto;
			expect(create).toBeDefined();
			expect(Object.keys(create?.properties ?? {})).toEqual([
				"displayName",
				"endpoint",
				"desiredState",
				"authentication",
			]);
			expect(create?.required).toEqual(["displayName", "endpoint"]);

			const replace = document.components.schemas.ReplaceConnectionDto;
			expect(replace?.required).toEqual(["expectedRevision", "displayName"]);
			expect(replace?.properties).toHaveProperty("endpoint");

			const connection = document.components.schemas.ConnectionResponseDto;
			expect(connection?.properties).toHaveProperty("runtime");
			expect(connection?.properties).not.toHaveProperty("endpoint");

			const connectionsPath = JSON.stringify(document.paths["/v1/mcp/connections"]);
			expect(connectionsPath).toContain("#/components/schemas/CreateConnectionDto");
			expect(connectionsPath).toContain("#/components/schemas/ConnectionResponseDto");
		} finally {
			await app.close();
		}
	});
});
