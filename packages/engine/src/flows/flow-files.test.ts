import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Flow, flowSchema, singleAgentFlow } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { createSandbox, type Sandbox } from "../testing/test-support";
import {
	createFlowDocuments,
	documentProjectFlows,
	type FlowDocuments,
} from "./flow-document";
import { createFlowFiles, type FlowFiles } from "./flow-files";

const SPACE = "space";
const PROJECT = "project";

const quick = (prompt: string): Flow =>
	flowSchema.parse(
		singleAgentFlow({ prompt, model: "sonnet", permissionMode: "acceptEdits" }),
	);

/** The flow with a second node after the first. */
function withSecondNode(flow: Flow): Flow {
	const [agent] = flow.nodes;
	if (agent?.type !== "agent") throw new Error("Expected an Agent node.");
	return {
		...flow,
		nodes: [...flow.nodes, { ...agent, id: "check", prompt: "Check it" }],
		edges: [
			{ id: "agent-check", from: agent.id, outcome: "pass", to: "check" },
		],
	};
}

async function refusal(promise: Promise<unknown>): Promise<Refusal> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof Refusal) return error;
		throw error;
	}
	throw new Error("Expected a refusal.");
}

describe("the revisions of a flow", () => {
	const clock = { at: 1_000 };
	let sandbox: Sandbox;
	let documents: FlowDocuments;
	let files: FlowFiles;

	beforeEach(async () => {
		clock.at = 1_000;
		sandbox = await createSandbox();
		documents = createFlowDocuments({ db: sandbox.db });
		files = createFlowFiles({
			flows: documentProjectFlows({
				documents,
				find: async () => ({}),
				deviceId: "laptop",
				now: () => clock.at,
			}),
			personNames: async () => new Map([["ada", "Ada"]]),
			deviceNames: async () => new Map([["laptop", "MacBook"]]),
		});
	});

	afterEach(async () => {
		await documents.close();
		await sandbox.cleanup();
	});

	/** Saves the first flow at 1000 and the one with a second node at 2000, both by Ada. */
	async function twoSaves() {
		await files.save(SPACE, PROJECT, "build", quick("Fix it"), "ada");
		clock.at = 2_000;
		await files.save(
			SPACE,
			PROJECT,
			"build",
			withSecondNode(quick("Fix it")),
			"ada",
		);
		return files.revisions(SPACE, PROJECT, "build", "ada");
	}

	test("lists each save newest first: who, when, on which Device, and what it changed", async () => {
		const [second, first] = await twoSaves();
		expect(second).toMatchObject({
			at: 2_000,
			kind: "save",
			person: { id: "ada", name: "Ada" },
			device: { id: "laptop", name: "MacBook" },
			current: true,
			changes: { added: 1, edges: 1, empty: false },
		});
		expect(first).toMatchObject({ at: 1_000, current: false, changes: null });
	});

	test("a save that changes nothing adds no revision", async () => {
		await twoSaves();
		await files.save(
			SPACE,
			PROJECT,
			"build",
			withSecondNode(quick("Fix it")),
			"ada",
		);
		expect(await files.revisions(SPACE, PROJECT, "build", "ada")).toHaveLength(
			2,
		);
	});

	test("shows a revision with what changes from the flow now to it, or from another revision", async () => {
		const [second, first] = await twoSaves();
		if (!first || !second) throw new Error("Expected two revisions.");

		const againstNow = await files.revision(
			SPACE,
			PROJECT,
			"build",
			first.id,
			undefined,
			"ada",
		);
		expect(againstNow.revision.flow?.nodes).toHaveLength(1);
		expect(againstNow.against.revisionId).toBeNull();
		expect(againstNow.against.flow?.nodes).toHaveLength(2);
		expect(againstNow.diff?.nodes.removed.map((node) => node.id)).toEqual([
			"check",
		]);

		const againstFirst = await files.revision(
			SPACE,
			PROJECT,
			"build",
			second.id,
			first.id,
			"ada",
		);
		expect(againstFirst.against.revisionId).toBe(first.id);
		expect(againstFirst.diff?.nodes.added.map((node) => node.id)).toEqual([
			"check",
		]);
	});

	test("restoring a revision saves its flow as a new revision of kind restore", async () => {
		const [, first] = await twoSaves();
		if (!first) throw new Error("Expected two revisions.");
		clock.at = 3_000;

		await files.restore(SPACE, PROJECT, "build", first.id, "ada");

		const loaded = await files.get(SPACE, PROJECT, "build", "ada");
		expect(loaded.flow?.nodes).toHaveLength(1);
		const [restored] = await files.revisions(SPACE, PROJECT, "build", "ada");
		expect(restored).toMatchObject({
			at: 3_000,
			kind: "restore",
			person: { id: "ada" },
			current: true,
			changes: { removed: 1 },
		});
	});

	test("refuses a revision that the flow does not have, and a flow that does not exist", async () => {
		await twoSaves();
		const unknown = await refusal(
			files.revision(SPACE, PROJECT, "build", "nope", undefined, "ada"),
		);
		expect(unknown.kind).toBe("not-found");
		expect(
			(await refusal(files.restore(SPACE, PROJECT, "build", "nope", "ada")))
				.kind,
		).toBe("not-found");
		expect(
			(await refusal(files.revisions(SPACE, PROJECT, "other", "ada"))).kind,
		).toBe("not-found");
	});
});
