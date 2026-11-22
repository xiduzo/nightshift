import { describe, expect, test } from "bun:test";
import { asBridgedTools } from "./bridged-tools";

describe("asBridgedTools", () => {
	test("a spec becomes a server tool with its name, description, fields and answer", async () => {
		const [tool] = asBridgedTools([
			{
				name: "echo",
				description: "Says the words back.",
				inputSchema: {
					type: "object",
					properties: { words: { type: "string", description: "The words." } },
					required: ["words"],
				},
				server: async (args) =>
					`You said ${(args as { words: string }).words}.`,
			},
		]);
		expect(tool?.name).toBe("echo");
		expect(tool?.description).toBe("Says the words back.");
		expect(tool?.inputSchema).toEqual({
			type: "object",
			properties: { words: { type: "string", description: "The words." } },
			required: ["words"],
		});
		expect(await tool?.execute?.({ words: "hi" })).toBe("You said hi.");
	});
});
