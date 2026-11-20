import { describe, expect, test } from "bun:test";
import { inMemoryEditingPorts } from "../adapters/out/in-memory-neighbours";
import { forgetNodeMemory } from "./forget-node-memory";

const ada = { personId: "ada", door: "session" } as const;
const flow = { spaceId: "space", projectId: "project", flowName: "build" };

describe("forgetNodeMemory", () => {
	test("forgets what a node saw, in every scope or in one", async () => {
		const ports = inMemoryEditingPorts();
		const forget = forgetNodeMemory(ports);
		await forget(ada, { ...flow, node: "fresh" });
		await forget(ada, { ...flow, node: "fresh", scope: "a" });
		expect(ports.memory.forgets).toEqual([
			{ flow, node: "fresh" },
			{ flow, node: "fresh", scope: "a" },
		]);
	});

	test("a project of another Space is not found, and nothing is forgotten", async () => {
		const ports = inMemoryEditingPorts();
		const forget = forgetNodeMemory(ports)(ada, {
			...flow,
			projectId: "elsewhere",
			node: "fresh",
		});
		await expect(forget).rejects.toThrow("This project does not exist.");
		expect(ports.memory.forgets).toEqual([]);
	});
});
