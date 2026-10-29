import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	FLOW_VERSION,
	type Flow,
	flowSchema,
	singleAgentFlow,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { createFlowDocuments, type FlowDocuments } from "./flow-document";
import { createProjectFlows } from "./project-flows";
import { createSpaceFlows, type SpaceFlows } from "./space-flows";

const SPACE = "space";
const PROJECT = "project";
/** Two projects of the Space, and one of another Space. */
const SPACE_OF: Record<string, string> = {
	project: SPACE,
	other: SPACE,
	elsewhere: "another-space",
};

/** The flows of the Space for Ada, over the documents. */
function adasFlows(
	documents: FlowDocuments,
	options: Partial<Parameters<typeof createSpaceFlows>[0]> & {
		now?: () => number;
	} = {},
): SpaceFlows {
	const { now, ...rest } = options;
	const spaceOf = async (projectId: string) => {
		const spaceId = SPACE_OF[projectId];
		if (spaceId === undefined) {
			throw new Refusal("not-found", "This project does not exist.");
		}
		return spaceId;
	};
	return createSpaceFlows({
		ready: Promise.resolve(),
		flows: createProjectFlows({
			documents,
			project: async (projectId) => ({ spaceId: await spaceOf(projectId) }),
			deviceId: "laptop",
			...(now ? { now } : {}),
		}),
		project: async (projectId, spaceId) => {
			if ((await spaceOf(projectId)) !== spaceId) {
				throw new Refusal("not-found", "This project does not exist.");
			}
		},
		...rest,
	})(SPACE, "ada");
}

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
	let files: SpaceFlows;

	beforeEach(async () => {
		clock.at = 1_000;
		sandbox = await createSandbox();
		documents = createFlowDocuments({ db: sandbox.db });
		files = adasFlows(documents, {
			now: () => clock.at,
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
		await files.save(PROJECT, "build", quick("Fix it"));
		clock.at = 2_000;
		await files.save(PROJECT, "build", withSecondNode(quick("Fix it")));
		return files.revisions(PROJECT, "build");
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
		await files.save(PROJECT, "build", withSecondNode(quick("Fix it")));
		expect(await files.revisions(PROJECT, "build")).toHaveLength(2);
	});

	test("shows a revision with what changes from the flow now to it, or from another revision", async () => {
		const [second, first] = await twoSaves();
		if (!first || !second) throw new Error("Expected two revisions.");

		const againstNow = await files.revision(
			PROJECT,
			"build",
			first.id,
			undefined,
		);
		expect(againstNow.revision.flow?.nodes).toHaveLength(1);
		expect(againstNow.against.revisionId).toBeNull();
		expect(againstNow.against.flow?.nodes).toHaveLength(2);
		expect(againstNow.diff?.nodes.removed.map((node) => node.id)).toEqual([
			"check",
		]);

		const againstFirst = await files.revision(
			PROJECT,
			"build",
			second.id,
			first.id,
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

		await files.restore(PROJECT, "build", first.id);

		const loaded = await files.get(PROJECT, "build");
		expect(loaded.flow?.nodes).toHaveLength(1);
		const [restored] = await files.revisions(PROJECT, "build");
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
			files.revision(PROJECT, "build", "nope", undefined),
		);
		expect(unknown.kind).toBe("not-found");
		expect((await refusal(files.restore(PROJECT, "build", "nope"))).kind).toBe(
			"not-found",
		);
		expect((await refusal(files.revisions(PROJECT, "other"))).kind).toBe(
			"not-found",
		);
	});
});

describe("moving a flow between projects", () => {
	let sandbox: Sandbox;
	let documents: FlowDocuments;
	let files: SpaceFlows;
	const OTHER = "other";

	beforeEach(async () => {
		sandbox = await createSandbox();
		documents = createFlowDocuments({ db: sandbox.db });
		files = adasFlows(documents);
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
		await files.save(PROJECT, "build", quick("Fix it"));
		const exported = await files.export(PROJECT, "build");
		expect(exported.fileName).toBe("build.json");
		expect(JSON.parse(exported.json)).toMatchObject({ version: FLOW_VERSION });

		const saved = await files.import(OTHER, "build", exported.json);
		expect(saved).toEqual({ name: "build", issues: [] });
		const [revision] = await files.revisions(OTHER, "build");
		expect(revision).toMatchObject({ kind: "import", person: { id: "ada" } });
	});

	test("an import of a name the project has gets a suffix", async () => {
		await files.save(PROJECT, "build", quick("Fix it"));
		const { json } = await files.export(PROJECT, "build");
		const saved = await files.import(PROJECT, "build", json);
		expect(saved.name).toBe("build-2");
		expect((await files.list(PROJECT)).map((f) => f.name)).toEqual([
			"build",
			"build-2",
		]);
	});

	test("an import brings a flow of an older format up to date", async () => {
		const flow = quick("Fix it");
		const old = JSON.stringify({ ...flow, version: 5 });
		await files.import(PROJECT, "old", old);
		const loaded = await files.get(PROJECT, "old");
		expect(loaded.flow?.version).toBe(FLOW_VERSION);
	});

	test("refuses a file that is not JSON, not a flow, or from a newer Night Shift", async () => {
		const newer = JSON.stringify({
			...quick("Fix it"),
			version: FLOW_VERSION + 1,
		});
		for (const json of ["{", JSON.stringify({ nodes: "none" }), newer]) {
			const refused = await refusal(files.import(PROJECT, "bad", json));
			expect(refused.kind).toBe("invalid");
		}
		expect(
			(await refusal(files.import(PROJECT, "bad", newer))).message,
		).toContain("newer version of Night Shift");
		expect(await files.list(PROJECT)).toEqual([]);
	});

	test("a copy into another project leaves the flows it calls behind, and says so", async () => {
		await files.save(PROJECT, "helper", quick("Help"));
		await files.save(PROJECT, "build", caller());

		const copied = await files.copy(PROJECT, "build", {
			projectId: OTHER,
			name: "build",
		});
		expect(copied.name).toBe("build");
		expect(copied.issues).toContainEqual(
			expect.objectContaining({ severity: "error", nodeId: "check" }),
		);
		expect((await files.list(OTHER)).map((f) => f.name)).toEqual(["build"]);
		const [revision] = await files.revisions(OTHER, "build");
		expect(revision?.kind).toBe("copy");
	});

	test("a copy refuses a name the other project has, and suggests a free one", async () => {
		await files.save(PROJECT, "build", quick("Fix it"));
		await files.save(OTHER, "build", quick("Theirs"));
		const refused = await refusal(
			files.copy(PROJECT, "build", { projectId: OTHER, name: "build" }),
		);
		expect(refused.kind).toBe("conflict");
		expect(refused.message).toContain('"build-2"');
	});
});

describe("the Space of a project", () => {
	let sandbox: Sandbox;
	let documents: FlowDocuments;
	let files: SpaceFlows;

	beforeEach(async () => {
		sandbox = await createSandbox();
		documents = createFlowDocuments({ db: sandbox.db });
		files = adasFlows(documents);
	});

	afterEach(async () => {
		await documents.close();
		await sandbox.cleanup();
	});

	test("a project of another Space is not found, for every read and save", async () => {
		const flow = quick("Fix it");
		for (const attempt of [
			files.list("elsewhere"),
			files.get("elsewhere", "build"),
			files.map("elsewhere"),
			files.save("elsewhere", "build", flow),
			files.remove("elsewhere", "build"),
			files.notices("elsewhere"),
			files.revisions("elsewhere", "build"),
			files.export("elsewhere", "build"),
			files.import("elsewhere", "build", JSON.stringify(flow)),
		]) {
			expect((await refusal(attempt)).kind).toBe("not-found");
		}
	});

	test("a copy into a project of another Space is not found, and saves nothing", async () => {
		await files.save(PROJECT, "build", quick("Fix it"));
		const refused = await refusal(
			files.copy(PROJECT, "build", { projectId: "elsewhere", name: "build" }),
		);
		expect(refused.kind).toBe("not-found");
	});
});
