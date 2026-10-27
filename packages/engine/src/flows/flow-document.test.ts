import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { project } from "@nightshift/db/schema";
import {
	FLOW_VERSION,
	type Flow,
	flowSchema,
	parsedFlows,
	singleAgentFlow,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import * as Y from "yjs";
import { projectFlowsContract } from "../testing/project-flows-contract";
import { createSandbox, type Sandbox } from "../testing/test-support";
import {
	createFlowDocuments,
	documentProjectFlows,
	documentSpace,
	type FlowDocument,
	type FlowDocuments,
	flowIdOf,
	flowRevisions,
	flowSources,
	saveFlow,
} from "./flow-document";
import type { ProjectFlows } from "./project-flows";

projectFlowsContract("the document adapter", async () => {
	const sandbox = await createSandbox();
	const documents = createFlowDocuments({ db: sandbox.db });
	return {
		flows: documentProjectFlows({
			documents,
			find: async () => ({}),
			deviceId: sandbox.deviceId,
		}),
		of: { projectId: "project", spaceId: sandbox.spaceId },
		dispose: async () => {
			await documents.close();
			await sandbox.cleanup();
		},
	};
});

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

function promptOf(flow: Flow | null | undefined, nodeId: string): string {
	const node = flow?.nodes.find((each) => each.id === nodeId);
	if (node?.type !== "agent") throw new Error(`No Agent node ${nodeId}.`);
	return node.prompt;
}

/** One Device: its database, its flow documents, and the adapter on them. */
type Replica = {
	sandbox: Sandbox;
	documents: FlowDocuments;
	flows: ProjectFlows;
	document(): Promise<FlowDocument>;
	dispose(): Promise<void>;
};

const of = { projectId: "project", personId: "person" };

async function replica(clock: { at: number }): Promise<Replica> {
	const sandbox = await createSandbox();
	const documents = createFlowDocuments({ db: sandbox.db });
	return {
		sandbox,
		documents,
		flows: documentProjectFlows({
			documents,
			find: async () => ({}),
			deviceId: sandbox.deviceId,
			now: () => clock.at,
		}),
		document: () => documents.open(of.projectId),
		dispose: async () => {
			await documents.close();
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
	return parsedFlows((await device.flows.flows(of)).sources);
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
		const entry = document.flows.get(flowId ?? "") as Y.Map<unknown>;
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
			document.flows.set("future-id", future);
			future.set("name", "future");
			future.set("createdAt", 1);
			future.set("version", FLOW_VERSION + 1);
			future.set("graph", { whatever: true });
		});

		expect(await read(laptop)).toEqual({});
		const refused = await refusal(laptop.flows.save(of, "future", twoNodes()));
		expect(refused.kind).toBe("conflict");
		expect(document.flows.size).toBe(1);
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

	test("a save records a revision: who, when, on which Device, and the flow", async () => {
		clock.at = 5_000;
		await laptop.flows.save(of, "build", twoNodes());
		const document = await laptop.document();
		const flowId = flowIdOf(document, "build") ?? "";
		expect(flowRevisions(document, flowId)).toEqual([
			{
				id: expect.any(String),
				at: 5_000,
				personId: "person",
				deviceId: laptop.sandbox.deviceId,
				kind: "save",
				flow: twoNodes(),
			},
		]);
	});

	test("a save that changes nothing records no revision, a draft with errors records one", async () => {
		await laptop.flows.save(of, "build", twoNodes());
		await laptop.flows.save(of, "build", twoNodes());
		await laptop.flows.save(of, "build", {
			...twoNodes(),
			edges: [{ id: "again", from: "a", outcome: "fail", to: "a" }],
		});
		const document = await laptop.document();
		expect(flowRevisions(document, flowIdOf(document, "build") ?? "")).toEqual([
			expect.anything(),
			expect.anything(),
		]);
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
		await laptop.documents.close();

		const again = createFlowDocuments({ db: laptop.sandbox.db });
		try {
			const document = await again.open(of.projectId);
			expect(parsedFlows(flowSources(document))).toEqual({
				build: twoNodes(),
			});
			expect(document.scheduleOrder.toArray()).toEqual(["nightly"]);
		} finally {
			await again.close();
		}
	});

	test("openAll opens the documents of every project, and byName finds them", async () => {
		await laptop.sandbox.db.insert(project).values({
			id: "listed",
			spaceId: laptop.sandbox.spaceId,
			name: "Listed",
			createdAt: new Date(),
		});
		const documents = await laptop.documents.openAll();
		expect(documents.map((document) => document.projectId)).toEqual(["listed"]);
		for (const document of documents) {
			expect(laptop.documents.byName(`flows:${document.projectId}`)).toBe(
				document.current,
			);
			expect(
				laptop.documents.byName(`flows-history:${document.projectId}`),
			).toBe(document.history);
		}
		expect(laptop.documents.byName("flows:nothing")).toBeNull();
	});

	test("a schedule that a newer Night Shift saved stays when the schedules are saved", async () => {
		const document = await laptop.document();
		await document.current.change(() => {
			document.schedules.set("future", { id: "future", enabled: "later" });
			document.scheduleOrder.push(["future"]);
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
		expect(document.schedules.has("future")).toBe(true);
	});
});

describe("the documents of a Replica, for the relay", () => {
	let sandbox: Sandbox;
	let documents: FlowDocuments;

	beforeEach(async () => {
		sandbox = await createSandbox();
		documents = createFlowDocuments({ db: sandbox.db });
		await sandbox.db.insert(project).values({
			id: "shop",
			spaceId: sandbox.spaceId,
			name: "Shop",
			createdAt: new Date(),
		});
	});

	afterEach(async () => {
		await documents.close();
		await sandbox.cleanup();
	});

	test("find opens the flow documents of a Project the Replica has, and no others", async () => {
		const found = await documents.find("flows-history:shop");
		expect(found?.name).toBe("flows-history:shop");
		expect(documents.byName("flows:shop")).not.toBeNull();
		expect(await documents.find("flows:elsewhere")).toBeNull();
		expect(await documents.find(`space:${sandbox.spaceId}`)).toBeNull();
	});

	test("documentSpace names the Space of a Space document and of a flow document", async () => {
		const spaceOf = documentSpace(sandbox.db);
		expect(await spaceOf(`space:${sandbox.spaceId}`)).toEqual({
			spaceId: sandbox.spaceId,
			kind: "space",
		});
		for (const name of ["flows:shop", "flows-history:shop"]) {
			expect(await spaceOf(name)).toEqual({
				spaceId: sandbox.spaceId,
				kind: "flows",
			});
		}
		expect(await spaceOf("flows:elsewhere")).toBeNull();
		expect(await spaceOf("device:someone")).toBeNull();
	});
});
