import { describe, expect, test } from "bun:test";
import { inMemoryEditingPorts } from "../adapters/out/in-memory-neighbours";
import { listKeptValues } from "./list-kept-values";

const ada = { personId: "ada", door: "session" } as const;
const kept = { name: "count", value: 3, runId: "run-1", updatedAt: 1 };

describe("listKeptValues", () => {
	test("lists the kept values of a flow of a project of the Space", async () => {
		const ports = inMemoryEditingPorts();
		ports.kept.values.push(kept);
		expect(
			await listKeptValues(ports)(ada, {
				spaceId: "space",
				projectId: "project",
				flowName: "build",
			}),
		).toEqual([kept]);
	});

	test("a project of another Space is not found", async () => {
		const ports = inMemoryEditingPorts();
		const list = listKeptValues(ports)(ada, {
			spaceId: "space",
			projectId: "elsewhere",
			flowName: "build",
		});
		await expect(list).rejects.toThrow("This project does not exist.");
	});
});
