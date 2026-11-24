import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { project } from "@nightshift/db/schema";
import {
	FLOW_VERSION,
	type Flow,
	flowSchema,
	listFlowSources,
	loadFlowSource,
	parsedFlows,
	scheduleSchema,
	singleAgentFlow,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { asDate } from "@nightshift/time";
import * as Y from "yjs";
import {
	createFlowDocuments,
	type FlowDocument,
	type FlowDocuments,
} from "../documents";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { wireStore as createProjectFlows, type ProjectFlows } from "./store";
import {
	flowIdOf,
	flowRevisions,
	flowSources,
} from "./store/adapters/out/yjs-flow-encoding";
import { saveFlow } from "./store/adapters/out/yjs-flow-saves";

/** A flow with two Agent nodes, `a` then `b`. */
const twoNodes = (): Flow => {
	const quick = flowSchema.parse(
		singleAgentFlow({
			prompt: "First",
			model: "sonnet",
			permissionMode: "acceptEdits",
		}),
	);
	const [agent] = quick.nodes;
	if (agent?.type !== "agent") throw new Error("Expected an Agent node.");
	return {
		...quick,
		start: "a",
		nodes: [
			{ ...agent, id: "a" },
			{ ...agent, id: "b", prompt: "Second" },
		],
		edges: [{ id: "a-b", from: "a", outcome: "pass", to: "b" }],
	};
};

/** The flow with the prompt of one node changed. */
function withPrompt(flow: Flow, nodeId: string, prompt: string): Flow {
	return {
		...flow,
		nodes: flow.nodes.map((node) =>
			node.id === nodeId && node.type === "agent" ? { ...node, prompt } : node,
		),
	};
}

/** The parts of the document's encoding that a test writes as another Night Shift would. */
const flowMap = (document: FlowDocument) =>
	document.current.doc.getMap<unknown>("flows");
const scheduleMap = (document: FlowDocument) =>
	document.current.doc.getMap<unknown>("schedules");
const scheduleOrderOf = (document: FlowDocument) =>
	document.current.doc.getArray<string>("scheduleOrder");

function promptOf(flow: Flow | null | undefined, nodeId: string): string {
	const node = flow?.nodes.find((each) => each.id === nodeId);
	if (node?.type !== "agent") throw new Error(`No Agent node ${nodeId}.`);
	return node.prompt;
}

/** One Device: its database, its flow documents, and its `ProjectFlows`. */
type Replica = {
	sandbox: Sandbox;
	documents: FlowDocuments;
	flows: ProjectFlows;
	document(): Promise<FlowDocument>;
	dispose(): Promise<void>;
};

const of = "project";

async function replica(clock: { at: number }): Promise<Replica> {
	const sandbox = await createSandbox();
	const documents = createFlowDocuments({ db: sandbox.db });
	return {
		sandbox,
		documents,
		flows: createProjectFlows({
			documents,
			project: async () => ({ spaceId: sandbox.spaceId }),
			deviceId: sandbox.deviceId,
			now: () => clock.at,
		}),
		document: () => documents.open(of),
		dispose: async () => {
			await documents.flush();
			await sandbox.cleanup();
		},
	};
}

/** What a Link does: each side gets what the other has, both documents. */
async function sync(a: Replica, b: Replica): Promise<void> {
	const [left, right] = [await a.document(), await b.document()];
	for (const [x, y] of [
		[left.current.doc, right.current.doc],
		[left.history.doc, right.history.doc],
	] as const) {
		Y.applyUpdate(y, Y.encodeStateAsUpdate(x, Y.encodeStateVector(y)), "link");
		Y.applyUpdate(x, Y.encodeStateAsUpdate(y, Y.encodeStateVector(x)), "link");
	}
}

async function read(device: Replica): Promise<Record<string, Flow | null>> {
	return parsedFlows(await device.flows.flows(of));
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

describe("the flow document", () => {
	const clock = { at: 1_000 };
	let laptop: Replica;
	let desktop: Replica;

	beforeEach(async () => {
		clock.at = 1_000;
		laptop = await replica(clock);
		desktop = await replica(clock);
	});

	afterEach(async () => {
		await laptop.dispose();
		await desktop.dispose();
	});

	test("edits of two different nodes on two Devices merge: both are kept", async () => {
		await laptop.flows.save(of, "build", twoNodes());
		await sync(laptop, desktop);

		await laptop.flows.save(of, "build", withPrompt(twoNodes(), "a", "Laptop"));
		await desktop.flows.save(
			of,
			"build",
			withPrompt(twoNodes(), "b", "Desktop"),
		);
		await sync(laptop, desktop);

		for (const device of [laptop, desktop]) {
			const { build } = await read(device);
			expect(promptOf(build, "a")).toBe("Laptop");
			expect(promptOf(build, "b")).toBe("Desktop");
		}
	});

	test("edits of the same node on two Devices keep one of them, the same on both", async () => {
		await laptop.flows.save(of, "build", twoNodes());
		await sync(laptop, desktop);

		await laptop.flows.save(of, "build", withPrompt(twoNodes(), "a", "Laptop"));
		await desktop.flows.save(
			of,
			"build",
			withPrompt(twoNodes(), "a", "Desktop"),
		);
		await sync(laptop, desktop);

		const onLaptop = promptOf((await read(laptop)).build, "a");
		expect(["Laptop", "Desktop"]).toContain(onLaptop);
		expect(promptOf((await read(desktop)).build, "a")).toBe(onLaptop);
	});

	test("two Devices that create a flow of one name keep both: the newer gets a suffix", async () => {
		await laptop.flows.save(of, "build", withPrompt(twoNodes(), "a", "Older"));
		clock.at = 2_000;
		await desktop.flows.save(of, "build", withPrompt(twoNodes(), "a", "Newer"));
		await sync(laptop, desktop);

		for (const device of [laptop, desktop]) {
			const flows = await read(device);
			expect(Object.keys(flows)).toEqual(["build", "build-2"]);
			expect(promptOf(flows.build, "a")).toBe("Older");
			expect(promptOf(flows["build-2"], "a")).toBe("Newer");
		}
	});

	test("two Devices that create the same flow keep one, and a save of it leaves no copy", async () => {
		for (const device of [laptop, desktop]) {
			await device.flows.save(of, "build", twoNodes());
		}
		await sync(laptop, desktop);
		for (const device of [laptop, desktop]) {
			expect(await read(device)).toEqual({ build: twoNodes() });
		}

		const changed = withPrompt(twoNodes(), "a", "Changed");
		await laptop.flows.save(of, "build", changed);
		await sync(laptop, desktop);
		for (const device of [laptop, desktop]) {
			expect(await read(device)).toEqual({ build: changed });
		}
	});

	test("a save of the suffixed name writes that name", async () => {
		await laptop.flows.save(of, "build", twoNodes());
		clock.at = 2_000;
		await desktop.flows.save(of, "build", withPrompt(twoNodes(), "a", "Mine"));
		await sync(laptop, desktop);

		await desktop.flows.save(
			of,
			"build-2",
			withPrompt(twoNodes(), "a", "Renamed"),
		);
		const document = await desktop.document();
		const flowId = flowIdOf(document, "build-2");
		const entry = flowMap(document).get(flowId ?? "") as Y.Map<unknown>;
		expect(entry.get("name")).toBe("build-2");
		expect(Object.keys(await read(desktop))).toEqual(["build", "build-2"]);
	});

	test("nodes added on two Devices are both kept, after the nodes before them", async () => {
		await laptop.flows.save(of, "build", twoNodes());
		await sync(laptop, desktop);

		const [agent] = twoNodes().nodes;
		if (agent === undefined) throw new Error("No node.");
		await laptop.flows.save(of, "build", {
			...twoNodes(),
			nodes: [...twoNodes().nodes, { ...agent, id: "c" }],
		});
		await desktop.flows.save(of, "build", {
			...twoNodes(),
			nodes: [...twoNodes().nodes, { ...agent, id: "d" }],
		});
		await sync(laptop, desktop);

		const ids = (await read(laptop)).build?.nodes.map((node) => node.id);
		expect(ids?.slice(0, 2)).toEqual(["a", "b"]);
		expect([...(ids ?? [])].sort()).toEqual(["a", "b", "c", "d"]);
		expect((await read(desktop)).build?.nodes.map((node) => node.id)).toEqual(
			ids,
		);
	});

	test("a save keeps the order of the nodes, also a new order", async () => {
		const flow = twoNodes();
		await laptop.flows.save(of, "build", flow);
		await laptop.flows.save(of, "build", {
			...flow,
			nodes: [...flow.nodes].reverse(),
		});
		expect((await read(laptop)).build?.nodes.map((node) => node.id)).toEqual([
			"b",
			"a",
		]);
	});

	test("a flow that a newer Night Shift saved is not read, and a save over it is refused", async () => {
		const document = await laptop.document();
		await document.current.change(() => {
			const future = new Y.Map<unknown>();
			flowMap(document).set("future-id", future);
			future.set("name", "future");
			future.set("createdAt", 1);
			future.set("version", FLOW_VERSION + 1);
			future.set("graph", { whatever: true });
		});

		expect(await read(laptop)).toEqual({});
		const refused = await refusal(laptop.flows.save(of, "future", twoNodes()));
		expect(refused.kind).toBe("conflict");
		expect(flowMap(document).size).toBe(1);
	});

	test("a revision from a newer Night Shift is left out of the history", async () => {
		await laptop.flows.save(of, "build", twoNodes());
		const document = await laptop.document();
		const flowId = flowIdOf(document, "build") ?? "";
		await document.history.change(() => {
			document.history.doc.getArray(flowId).push([
				{
					id: "future",
					at: 2,
					personId: null,
					deviceId: "other",
					kind: "save",
					flow: { version: FLOW_VERSION + 1 },
				},
			]);
		});
		expect(flowRevisions(document, flowId).map((r) => r.kind)).toEqual([
			"save",
		]);
	});

	test("a read gives a flow its revision, and none for a merge that no revision records", async () => {
		await laptop.flows.save(of, "build", twoNodes());
		const document = await laptop.document();
		const [saved] = flowRevisions(document, flowIdOf(document, "build") ?? "");
		expect((await laptop.flows.flows(of)).build).toEqual({
			json: twoNodes(),
			revision: saved?.id as string,
		});

		await sync(laptop, desktop);
		await laptop.flows.save(of, "build", withPrompt(twoNodes(), "a", "Laptop"));
		await desktop.flows.save(
			of,
			"build",
			withPrompt(twoNodes(), "b", "Desktop"),
		);
		await sync(laptop, desktop);
		expect((await laptop.flows.flows(of)).build).not.toHaveProperty("revision");
	});

	describe("keepShapes (Q40)", () => {
		const shape = {
			type: "object",
			properties: { title: { type: "string" } },
		};
		const agentA = { id: "a", type: "agent" };

		test("an edit of another node on another Device merges with it", async () => {
			await laptop.flows.save(of, "build", twoNodes());
			await sync(laptop, desktop);
			await laptop.flows.keepShapes(of, "build", agentA, { data: shape });
			await desktop.flows.save(
				of,
				"build",
				withPrompt(twoNodes(), "b", "Desktop"),
			);
			await sync(laptop, desktop);
			const { build } = await read(laptop);
			expect(promptOf(build, "b")).toBe("Desktop");
			expect(build?.nodes.find((node) => node.id === "a")).toMatchObject({
				outputInferred: true,
			});
		});
	});

	test("the first revisions of one flow on two Devices are both kept", async () => {
		const document = await laptop.document();
		await saveFlow(document, {
			name: "build",
			flow: twoNodes(),
			kind: "import",
			personId: null,
			deviceId: "laptop",
			at: 1,
		});
		await sync(laptop, desktop);
		const flowId = flowIdOf(document, "build") ?? "";
		const other = await desktop.document();
		await other.history.change(() => {
			other.history.doc.getArray(flowId).push([
				{
					id: "desktop",
					at: 2,
					personId: null,
					deviceId: "desktop",
					kind: "merge",
					flow: twoNodes(),
				},
			]);
		});
		await saveFlow(document, {
			name: "build",
			flow: withPrompt(twoNodes(), "a", "Again"),
			kind: "save",
			personId: "person",
			deviceId: "laptop",
			at: 3,
		});
		await sync(laptop, desktop);
		expect(
			flowRevisions(other, flowId)
				.map((revision) => revision.kind)
				.sort(),
		).toEqual(["import", "merge", "save"]);
	});

	test("the documents stay in the Replica: a new start reads the same flows", async () => {
		await laptop.flows.save(of, "build", twoNodes());
		await laptop.flows.saveSchedules(of, [
			{
				id: "nightly",
				flow: "build",
				inputs: {},
				cron: "0 22 * * *",
				enabled: true,
			},
		]);
		await laptop.documents.flush();

		const again = createFlowDocuments({ db: laptop.sandbox.db });
		try {
			const document = await again.open(of);
			expect(parsedFlows(flowSources(document))).toEqual({
				build: twoNodes(),
			});
			expect(scheduleOrderOf(document).toArray()).toEqual(["nightly"]);
		} finally {
			await again.flush();
		}
	});

	test("openAll opens the documents of every project", async () => {
		await laptop.sandbox.db.insert(project).values({
			id: "listed",
			spaceId: laptop.sandbox.spaceId,
			name: "Listed",
			createdAt: asDate(),
		});
		const documents = await laptop.documents.openAll();
		expect(
			documents.map((d) => [d.projectId, d.current.name, d.history.name]),
		).toEqual([["listed", "flows:listed", "flows-history:listed"]]);
	});

	test("a schedule that a newer Night Shift saved stays when the schedules are saved", async () => {
		const document = await laptop.document();
		await document.current.change(() => {
			scheduleMap(document).set("future", { id: "future", enabled: "later" });
			scheduleOrderOf(document).push(["future"]);
		});
		const nightly = {
			id: "nightly",
			flow: "build",
			inputs: {},
			cron: "0 22 * * *",
			enabled: true,
		};
		await laptop.flows.saveSchedules(of, [nightly]);
		const loaded = await laptop.flows.schedules(of, { validate: false });
		expect(loaded.schedules).toEqual([nightly]);
		expect(loaded.issues).toEqual([
			expect.objectContaining({ severity: "warning" }),
		]);
		expect(scheduleMap(document).has("future")).toBe(true);
	});
});

describe("a flow of an older format (ADR 43)", () => {
	const clock = { at: 1_000 };
	let laptop: Replica;

	beforeEach(async () => {
		clock.at = 1_000;
		laptop = await replica(clock);
	});

	afterEach(async () => {
		await laptop.dispose();
	});

	/** The flow `build` as a Night Shift of format 6 stored it, with its revision. */
	async function storeFormat6() {
		await laptop.flows.save(of, "build", twoNodes());
		const document = await laptop.document();
		const flowId = flowIdOf(document, "build") ?? "";
		await document.current.change(() => {
			const flow = flowMap(document).get(flowId) as Y.Map<unknown>;
			flow.set("version", 6);
			const nodes = flow.get("nodes") as Y.Map<unknown>;
			nodes.set("a", { ...(nodes.get("a") as object), tools: ["github"] });
		});
		await document.history.change(() => {
			const revisions = document.history.doc.getArray<object>(flowId);
			const [last] = revisions.toArray();
			revisions.delete(0, 1);
			revisions.push([
				{ ...last, kind: "upgrade", flow: { ...twoNodes(), version: 6 } },
			]);
		});
		return document;
	}

	/** Both documents as bytes: any write at all changes them. */
	const bytes = (document: FlowDocument) =>
		[document.current.doc, document.history.doc].map((doc) =>
			Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"),
		);

	test("it is listed with one issue and no flow, as it is stored", async () => {
		await storeFormat6();
		const sources = await laptop.flows.flows(of);
		expect(sources.build).toMatchObject({
			json: { version: 6, nodes: [{ tools: ["github"] }, {}] },
		});
		expect(loadFlowSource(sources, "build")).toMatchObject({
			flow: null,
			issues: [
				{
					severity: "error",
					message: "An older version of Night Shift made this flow.",
				},
			],
		});
		expect(listFlowSources(sources)).toMatchObject([
			{ name: "build", nodeCount: null, errorCount: 1 },
		]);
	});

	test("no read and no write changes the document", async () => {
		const document = await storeFormat6();
		const before = bytes(document);
		await laptop.flows.flows(of);
		expect(await laptop.flows.revisions(of, "build")).toMatchObject([
			{ kind: "upgrade", flow: { version: 6 } },
		]);
		await laptop.flows.schedules(of);
		await laptop.flows.notices(of);
		for (const kind of ["save", "restore", "import"] as const) {
			const refused = await refusal(
				laptop.flows.save(of, "build", twoNodes(), { kind }),
			);
			expect(refused.kind).toBe("conflict");
		}
		expect(
			await laptop.flows.keepShapes(
				of,
				"build",
				{ id: "a", type: "agent" },
				{ data: { type: "object" } },
			),
		).toBe(false);
		expect(
			await laptop.flows.keepOutputTypes(of, "build", [
				{ name: "x", value: "y", type: "text" },
			]),
		).toBe(false);
		expect(bytes(document)).toEqual(before);
	});

	test("a save of another flow leaves it as it is", async () => {
		const document = await storeFormat6();
		const flowId = flowIdOf(document, "build") ?? "";
		const raw = (flowMap(document).get(flowId) as Y.Map<unknown>).toJSON();
		await laptop.flows.save(of, "other", twoNodes());
		expect((flowMap(document).get(flowId) as Y.Map<unknown>).toJSON()).toEqual(
			raw,
		);
	});

	test("a schedule of it stays, and says that the flow does not load", async () => {
		await storeFormat6();
		const nightly = scheduleSchema.parse({
			id: "nightly",
			flow: "build",
			cron: "0 2 * * *",
		});
		const says = [
			expect.objectContaining({ severity: "error", scheduleId: "nightly" }),
		];
		expect(await laptop.flows.saveSchedules(of, [nightly])).toEqual(says);
		const read = await laptop.flows.schedules(of);
		expect(read.schedules).toEqual([nightly]);
		expect(read.issues).toEqual(says);
	});

	test("a person may delete it, and its revisions stay", async () => {
		const document = await storeFormat6();
		const flowId = flowIdOf(document, "build") ?? "";
		await laptop.flows.remove(of, "build");
		expect(await laptop.flows.flows(of)).toEqual({});
		expect(flowRevisions(document, flowId)).toHaveLength(1);
	});
});
