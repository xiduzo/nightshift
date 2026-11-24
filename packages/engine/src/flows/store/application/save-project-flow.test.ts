import { describe, expect, test } from "bun:test";
import { type Flow, flowSchema, singleAgentFlow } from "@nightshift/flows";
import { inMemoryStorePorts } from "../adapters/out/in-memory-neighbours";
import { saveProjectFlow } from "./save-project-flow";

const quick = (prompt: string): Flow =>
	flowSchema.parse(
		singleAgentFlow({ prompt, model: "sonnet", permissionMode: "acceptEdits" }),
	);

describe("saveProjectFlow", () => {
	test("saves a revision of kind save on this Device at the clock's time, by nobody", async () => {
		const ports = inMemoryStorePorts();
		const issues = await saveProjectFlow(ports)({
			projectId: "project",
			name: "build",
			flow: quick("Write"),
		});
		expect(issues).toEqual([]);
		const revisions = await ports.store.revisions("project", "build");
		expect(
			revisions.map((r) => [r.kind, r.personId, r.deviceId, r.at]),
		).toEqual([["save", null, "laptop", 1000]]);
	});

	test("records the kind and the Person it is given", async () => {
		const ports = inMemoryStorePorts();
		await saveProjectFlow(ports)({
			projectId: "project",
			name: "build",
			flow: quick("Write"),
			kind: "restore",
			personId: "ada",
		});
		const [revision] = await ports.store.revisions("project", "build");
		expect([revision?.kind, revision?.personId]).toEqual(["restore", "ada"]);
	});

	test("returns the issues of a draft", async () => {
		const ports = inMemoryStorePorts();
		const draft: Flow = { ...quick("Write"), start: "nowhere" };
		const issues = await saveProjectFlow(ports)({
			projectId: "project",
			name: "build",
			flow: draft,
		});
		expect(issues.length).toBeGreaterThan(0);
	});

	test("refuses a name no flow may have, before it asks for the Project", async () => {
		const ports = inMemoryStorePorts();
		const save = saveProjectFlow(ports)({
			projectId: "project",
			name: "Not a name!",
			flow: quick("Write"),
		});
		await expect(save).rejects.toThrow(
			'The flow name "Not a name!" is not valid.',
		);
		expect(ports.projects.asked).toEqual([]);
	});

	test("refuses a Project this Replica does not have", async () => {
		const ports = inMemoryStorePorts();
		const save = saveProjectFlow(ports)({
			projectId: "gone",
			name: "build",
			flow: quick("Write"),
		});
		await expect(save).rejects.toThrow("This project does not exist.");
		expect(await ports.store.read("gone")).toEqual({});
	});
});
