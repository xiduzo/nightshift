import { describe, expect, test } from "bun:test";
import { flowSchema, singleAgentFlow } from "@nightshift/flows";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryEditingPorts } from "../adapters/out/in-memory-neighbours";
import { saveFlow } from "./save-flow";

const ada = { personId: "ada", door: "session" } as const;
const quick = flowSchema.parse(
	singleAgentFlow({
		prompt: "Write",
		model: "sonnet",
		permissionMode: "acceptEdits",
	}),
);
const request = {
	spaceId: "space",
	projectId: "project",
	name: "build",
	flow: quick,
};

describe("saveFlow", () => {
	test("saves as the Person who acts, and notes a new flow once", async () => {
		const ports = inMemoryEditingPorts();
		const save = saveFlow(ports);
		await save(ada, request);
		await save(ada, request);
		expect(ports.flows.saves.map((saved) => saved.personId)).toEqual([
			"ada",
			"ada",
		]);
		expect(ports.usage.notes).toEqual([
			{ kind: "flow-created", from: "blank" },
		]);
	});

	test("a save by Night Shift names no Person", async () => {
		const ports = inMemoryEditingPorts();
		await saveFlow(ports)(NIGHT_SHIFT, request);
		expect(ports.flows.saves[0]?.personId).toBeUndefined();
	});

	test("a project of another Space is not found, and nothing is saved", async () => {
		const ports = inMemoryEditingPorts();
		const save = saveFlow(ports)(ada, { ...request, projectId: "elsewhere" });
		await expect(save).rejects.toThrow("This project does not exist.");
		expect(ports.flows.saves).toEqual([]);
		expect(ports.usage.notes).toEqual([]);
	});
});
