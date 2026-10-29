import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	type Flow,
	flowSchema,
	parsedFlows,
	type Schedule,
	scheduleSchema,
	singleAgentFlow,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import * as Y from "yjs";
import { createSandbox, type Sandbox } from "../testing/test-support";
import {
	addNotices,
	createFlowDocuments,
	type FlowDocument,
	type FlowDocuments,
} from "./flow-document";
import { createProjectFlows, type ProjectFlows } from "./project-flows";

let sandbox: Sandbox;
let documents: FlowDocuments;
let flows: ProjectFlows;
/** Whether the next change of the Host's current flows fails: what a crash in the middle leaves. */
let crashNext = false;

/** The flows over the documents, with a clock and a Project that is always there. */
function flowsOn(over: FlowDocuments): ProjectFlows {
	return createProjectFlows({
		documents: {
			openAll: () => over.openAll(),
			open: async (projectId) => {
				const document = await over.open(projectId);
				return projectId !== HOSTED ? document : crashing(document);
			},
		},
		project: async () => ({ spaceId: sandbox.spaceId }),
		deviceId: sandbox.deviceId,
		now: () => 10,
	});
}

function crashing(document: FlowDocument): FlowDocument {
	return {
		...document,
		current: {
			...document.current,
			change: async (fn) => {
				if (!crashNext) return document.current.change(fn);
				crashNext = false;
				throw new Error("Night Shift stopped.");
			},
		},
	};
}

beforeEach(async () => {
	sandbox = await createSandbox();
	documents = createFlowDocuments({ db: sandbox.db });
	flows = flowsOn(documents);
	crashNext = false;
});
afterEach(async () => {
	await documents.close();
	await sandbox.cleanup();
});

const quick = (): Flow =>
	flowSchema.parse(
		singleAgentFlow({
			prompt: "Fix it",
			model: "sonnet",
			permissionMode: "acceptEdits",
		}),
	);

/** A draft with an error: a loop without a `max`. */
const unbounded = (): Flow => ({
	...quick(),
	edges: [{ id: "again", from: "agent", outcome: "fail", to: "agent" }],
});

const nightly: Schedule = {
	id: "nightly",
	flow: "quick",
	inputs: {},
	cron: "0 22 * * *",
	enabled: true,
};

async function refusal(promise: Promise<unknown>): Promise<Refusal> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof Refusal) return error;
		throw error;
	}
	throw new Error("Expected a refusal.");
}

const P = "project";

describe("the flows and schedules of a project", () => {
	test("a project without flows has none and no schedules", async () => {
		expect(await flows.flows(P)).toEqual({});
		expect(await flows.schedules(P)).toMatchObject({
			schedules: [],
			issues: [],
		});
	});

	test("a saved flow reads back by name, as the current version", async () => {
		expect(await flows.save(P, "quick", quick())).toEqual([]);
		const sources = await flows.flows(P);
		expect(Object.keys(sources)).toEqual(["quick"]);
		expect(parsedFlows(sources)).toEqual({ quick: quick() });
	});

	test("a draft with errors is saved, and the save returns its issues", async () => {
		expect(await flows.save(P, "draft", unbounded())).toEqual([
			expect.objectContaining({ severity: "error", nodeId: "agent" }),
		]);
		expect(parsedFlows(await flows.flows(P))).toEqual({ draft: unbounded() });
	});

	test("a save replaces the flow of that name", async () => {
		await flows.save(P, "quick", unbounded());
		await flows.save(P, "quick", quick());
		expect(parsedFlows(await flows.flows(P))).toEqual({ quick: quick() });
	});

	test("a save refuses a name that is not a flow name", async () => {
		expect((await refusal(flows.save(P, "Not A Name", quick()))).kind).toBe(
			"invalid",
		);
	});

	test("a removed flow is gone; removing it again is not found", async () => {
		await flows.save(P, "quick", quick());
		await flows.save(P, "other", quick());
		await flows.remove(P, "quick");
		expect(Object.keys(await flows.flows(P))).toEqual(["other"]);
		expect((await refusal(flows.remove(P, "quick"))).kind).toBe("not-found");
	});

	test("a project that is not there is not found, for a read and a save", async () => {
		const missing = createProjectFlows({
			documents,
			project: async () => {
				throw new Refusal("not-found", "This project does not exist.");
			},
			deviceId: sandbox.deviceId,
		});
		expect((await refusal(missing.flows(P))).kind).toBe("not-found");
		expect((await refusal(missing.save(P, "quick", quick()))).kind).toBe(
			"not-found",
		);
		expect((await refusal(missing.schedules(P))).kind).toBe("not-found");
	});

	test("saved schedules read back, checked against the flows", async () => {
		expect(await flows.saveSchedules(P, [nightly])).toEqual([
			expect.objectContaining({
				severity: "error",
				scheduleId: "nightly",
				message: 'The flow "quick" does not exist.',
			}),
		]);
		await flows.save(P, "quick", quick());
		expect(await flows.schedules(P)).toMatchObject({
			schedules: [nightly],
			issues: [],
		});
	});

	test("schedules read without the checks have no issues", async () => {
		await flows.saveSchedules(P, [nightly]);
		expect(await flows.schedules(P, { validate: false })).toMatchObject({
			schedules: [nightly],
			issues: [],
		});
	});

	test("a notice reads until a person dismisses it, on every Device", async () => {
		await addNotices(await documents.open(P), [
			{ kind: "folder-kept", message: "Kept.", deviceId: "laptop", at: 1 },
		]);
		const [notice] = await flows.notices(P);
		expect(notice).toMatchObject({ kind: "folder-kept", message: "Kept." });
		await flows.dismissNotice(P, notice?.id ?? "");
		await flows.dismissNotice(P, notice?.id ?? "");
		expect(await flows.notices(P)).toEqual([]);
	});
});

/** The Project of the Device's own Space, and the Project with its remote in the Host's. */
const LOCAL_PROJECT = "p-local";
const HOSTED = "p-hosted";
/** A Person's id in the Device's own Space, and in the Host's. */
const LOCAL = "ada-local";
const HOSTED_PERSON = "ada-hosted";

const flowWith = (prompt: string): Flow =>
	flowSchema.parse(
		singleAgentFlow({ prompt, model: "sonnet", permissionMode: "acceptEdits" }),
	);

async function save(
	projectId: string,
	name: string,
	prompt: string,
	personId: string,
) {
	await flows.save(projectId, name, flowWith(prompt), { personId });
}

const schedule = (input: Partial<Schedule>): Schedule =>
	scheduleSchema.parse({ cron: "0 22 * * *", ...input });

async function promptOf(projectId: string, name: string) {
	const flow = parsedFlows(await flows.flows(projectId))[name];
	const [node] = flow?.nodes ?? [];
	return node?.type === "agent" ? node.prompt : null;
}

/** The Host's Project has `triage`; the Device's has `triage` too, and `review`. */
async function seed() {
	await save(HOSTED, "triage", "Hosted triage", HOSTED_PERSON);
	await save(LOCAL_PROJECT, "triage", "Local triage", LOCAL);
	await save(LOCAL_PROJECT, "triage", "Local triage, again", LOCAL);
	await save(LOCAL_PROJECT, "review", "Local review", LOCAL);
	await flows.saveSchedules(HOSTED, [
		schedule({ id: "nightly", flow: "triage" }),
		schedule({ id: "same", flow: "review" }),
	]);
	await flows.saveSchedules(LOCAL_PROJECT, [
		schedule({ id: "nightly", flow: "triage", person: LOCAL }),
		schedule({ id: "weekly", flow: "review", cron: "0 8 * * 1" }),
		schedule({ id: "same", flow: "review" }),
	]);
}

const merge = () =>
	flows.merge(LOCAL_PROJECT, HOSTED, { persons: { [LOCAL]: HOSTED_PERSON } });

/** The state of both of the Host's documents: what changed nothing leaves as it is. */
async function stateOf(projectId: string) {
	const { current, history } = await documents.open(projectId);
	return [Y.encodeStateVector(current.doc), Y.encodeStateVector(history.doc)];
}

describe("the merge of one project's flows into another's", () => {
	test("both keep every flow: the destination's keep their names, a source flow with a taken name gets the next free one", async () => {
		await seed();
		const plan = await merge();

		expect(plan.flows).toEqual({ triage: "triage-2" });
		expect(Object.keys(await flows.flows(HOSTED))).toEqual([
			"review",
			"triage",
			"triage-2",
		]);
		expect(await promptOf(HOSTED, "triage")).toBe("Hosted triage");
		expect(await promptOf(HOSTED, "triage-2")).toBe("Local triage, again");
		expect(await promptOf(HOSTED, "review")).toBe("Local review");
		// The name is stored: it stays when the other flow goes.
		await flows.remove(HOSTED, "triage");
		expect(Object.keys(await flows.flows(HOSTED))).toEqual([
			"review",
			"triage-2",
		]);
	});

	test("each flow keeps its revisions, with the Person's id in the destination", async () => {
		await seed();
		const before = await flows.revisions(LOCAL_PROJECT, "triage");
		await merge();

		const after = await flows.revisions(HOSTED, "triage-2");
		expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
		expect(after.map((r) => r.personId)).toEqual([
			HOSTED_PERSON,
			HOSTED_PERSON,
		]);
		expect(await flows.revisions(HOSTED, "triage")).toHaveLength(1);
		// The flow reads with the revision it was saved as.
		const source = (await flows.flows(HOSTED))["triage-2"];
		expect(source && "json" in source ? source.revision : null).toBe(
			before.at(-1)?.id,
		);
	});

	test("schedules follow their flow, one that the destination has is one, and a taken id gets the next free one", async () => {
		await seed();
		const plan = await merge();

		expect(plan.schedules).toEqual({ nightly: "nightly-2" });
		const { schedules } = await flows.schedules(HOSTED, { validate: false });
		expect(
			schedules.map(({ id, flow, person }) => ({ id, flow, person })),
		).toEqual([
			{ id: "nightly", flow: "triage", person: undefined },
			{ id: "same", flow: "review", person: undefined },
			{ id: "nightly-2", flow: "triage-2", person: HOSTED_PERSON },
			{ id: "weekly", flow: "review", person: undefined },
		]);
	});

	test("a flow with the name and the content of one in the destination reads once, with both histories", async () => {
		await save(HOSTED, "triage", "Same triage", HOSTED_PERSON);
		await save(LOCAL_PROJECT, "triage", "Same triage", LOCAL);
		const plan = await merge();

		expect(plan.flows).toEqual({});
		expect(Object.keys(await flows.flows(HOSTED))).toEqual(["triage"]);
		// The older reads: the Host's, with its one revision.
		expect(await flows.revisions(HOSTED, "triage")).toEqual([
			expect.objectContaining({ personId: HOSTED_PERSON }),
		]);
	});

	test("a preview says what the merge renames and changes nothing", async () => {
		await seed();
		const state = await stateOf(HOSTED);
		expect(
			await flows.planMerge(LOCAL_PROJECT, HOSTED, { [LOCAL]: HOSTED_PERSON }),
		).toEqual({
			flows: { triage: "triage-2" },
			schedules: { nightly: "nightly-2" },
		});
		expect(await stateOf(HOSTED)).toEqual(state);
	});

	test("a merge that runs again changes nothing", async () => {
		await seed();
		await merge();
		const state = await stateOf(HOSTED);

		expect(await merge()).toEqual({ flows: {}, schedules: {} });
		expect(await flows.planMerge(LOCAL_PROJECT, HOSTED)).toEqual({
			flows: {},
			schedules: {},
		});
		expect(await stateOf(HOSTED)).toEqual(state);
	});

	test("a merge cut short after the history runs again to its end", async () => {
		await seed();
		crashNext = true;
		await expect(merge()).rejects.toThrow("Night Shift stopped.");
		// The history merged, the flows did not.
		expect(Object.keys(await flows.flows(HOSTED))).toEqual(["triage"]);

		await merge();
		expect(await flows.revisions(HOSTED, "triage-2")).toHaveLength(2);
		expect(Object.keys(await flows.flows(HOSTED))).toEqual([
			"review",
			"triage",
			"triage-2",
		]);
	});

	test("the merge is kept: the documents read it back from the Replica", async () => {
		await seed();
		await merge();
		await documents.close();
		documents = createFlowDocuments({ db: sandbox.db });
		flows = flowsOn(documents);
		expect(Object.keys(await flows.flows(HOSTED))).toEqual([
			"review",
			"triage",
			"triage-2",
		]);
		expect(await flows.planMerge(LOCAL_PROJECT, HOSTED)).toEqual({
			flows: {},
			schedules: {},
		});
	});
});
