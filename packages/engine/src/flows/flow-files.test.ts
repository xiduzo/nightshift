import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	FLOW_VERSION,
	type Flow,
	flowSchema,
	singleAgentFlow,
} from "@nightshift/flows";
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

describe("moving a flow between projects", () => {
	let sandbox: Sandbox;
	let documents: FlowDocuments;
	let files: FlowFiles;
	const OTHER = "other";

	beforeEach(async () => {
		sandbox = await createSandbox();
		documents = createFlowDocuments({ db: sandbox.db });
		files = createFlowFiles({
			flows: documentProjectFlows({
				documents,
				find: async () => ({}),
				deviceId: "laptop",
			}),
		});
	});

	afterEach(async () => {
		await documents.close();
		await sandbox.cleanup();
	});

	/** A flow whose second node calls the flow `helper`. */
	function caller(): Flow {
		const flow = withSecondNode(quick("Fix it"));
		return {
			...flow,
			nodes: [
				...flow.nodes.filter((node) => node.id !== "check"),
				{
					id: "check",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "helper",
					inputs: {},
				},
			],
		};
	}

	test("an export is the flow as JSON, which an import in another project saves as a revision of kind import", async () => {
		await files.save(SPACE, PROJECT, "build", quick("Fix it"), "ada");
		const exported = await files.export(SPACE, PROJECT, "build", "ada");
		expect(exported.fileName).toBe("build.json");
		expect(JSON.parse(exported.json)).toMatchObject({ version: FLOW_VERSION });

		const saved = await files.import(
			SPACE,
			OTHER,
			"build",
			exported.json,
			"ada",
		);
		expect(saved).toEqual({ name: "build", issues: [] });
		const [revision] = await files.revisions(SPACE, OTHER, "build", "ada");
		expect(revision).toMatchObject({ kind: "import", person: { id: "ada" } });
	});

	test("an import of a name the project has gets a suffix", async () => {
		await files.save(SPACE, PROJECT, "build", quick("Fix it"), "ada");
		const { json } = await files.export(SPACE, PROJECT, "build", "ada");
		const saved = await files.import(SPACE, PROJECT, "build", json, "ada");
		expect(saved.name).toBe("build-2");
		expect(
			(await files.list(SPACE, PROJECT, "ada")).map((f) => f.name),
		).toEqual(["build", "build-2"]);
	});

	test("an import brings a flow of an older format up to date", async () => {
		const flow = quick("Fix it");
		const old = JSON.stringify({ ...flow, version: 5 });
		await files.import(SPACE, PROJECT, "old", old, "ada");
		const loaded = await files.get(SPACE, PROJECT, "old", "ada");
		expect(loaded.flow?.version).toBe(FLOW_VERSION);
	});

	test("refuses a file that is not JSON, not a flow, or from a newer Night Shift", async () => {
		const newer = JSON.stringify({
			...quick("Fix it"),
			version: FLOW_VERSION + 1,
		});
		for (const json of ["{", JSON.stringify({ nodes: "none" }), newer]) {
			const refused = await refusal(
				files.import(SPACE, PROJECT, "bad", json, "ada"),
			);
			expect(refused.kind).toBe("invalid");
		}
		expect(
			(await refusal(files.import(SPACE, PROJECT, "bad", newer, "ada")))
				.message,
		).toContain("newer version of Night Shift");
		expect(await files.list(SPACE, PROJECT, "ada")).toEqual([]);
	});

	test("a copy into another project leaves the flows it calls behind, and says so", async () => {
		await files.save(SPACE, PROJECT, "helper", quick("Help"), "ada");
		await files.save(SPACE, PROJECT, "build", caller(), "ada");

		const copied = await files.copy(
			SPACE,
			PROJECT,
			"build",
			{ projectId: OTHER, name: "build" },
			"ada",
		);
		expect(copied.name).toBe("build");
		expect(copied.issues).toContainEqual(
			expect.objectContaining({ severity: "error", nodeId: "check" }),
		);
		expect((await files.list(SPACE, OTHER, "ada")).map((f) => f.name)).toEqual([
			"build",
		]);
		const [revision] = await files.revisions(SPACE, OTHER, "build", "ada");
		expect(revision?.kind).toBe("copy");
	});

	test("a copy refuses a name the other project has, and suggests a free one", async () => {
		await files.save(SPACE, PROJECT, "build", quick("Fix it"), "ada");
		await files.save(SPACE, OTHER, "build", quick("Theirs"), "ada");
		const refused = await refusal(
			files.copy(
				SPACE,
				PROJECT,
				"build",
				{ projectId: OTHER, name: "build" },
				"ada",
			),
		);
		expect(refused.kind).toBe("conflict");
		expect(refused.message).toContain('"build-2"');
	});
});
