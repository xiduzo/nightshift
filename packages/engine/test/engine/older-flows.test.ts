import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { fakeHarness } from "@nightshift/agents/testing";
import { run, step } from "@nightshift/db/schema";
import { FLOW_VERSION, flowSchema } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { now } from "@nightshift/time";
import { eq } from "drizzle-orm";
import type * as Y from "yjs";
import { NIGHT_SHIFT } from "../../src/contract";
import { createFlowDocuments } from "../../src/documents";
import type { Engine } from "../../src/engine";
import type { EngineEventType } from "../../src/log/events/events";
import { createRunHistory } from "../../src/log/history/history";
import { createRunLog } from "../../src/log/run-log/run-log";
import { createRunBus } from "../../src/log/transcript/bus";
import type { SpaceEngine } from "../../src/space-engine";
import { appendEvent } from "../../src/testing/append-event";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../../src/testing/test-support";
import { createEngine } from "../../src/wire";

/**
 * Only the current format is read (ADR 43): what a flow, a run, a revision
 * and a file of an older format do, everywhere they are met. Each gives
 * the one answer, nothing throws, and nothing is written over or deleted.
 * So does a current one that names a device or a profile by its name.
 */

const OLDER_RUN =
	"This run is from an older version of Night Shift. Start the flow again.";
const OLDER_FLOW = "An older version of Night Shift made this flow.";

/** A flow of the current format. */
const current = flowSchema.parse({
	version: FLOW_VERSION,
	start: "say",
	nodes: [
		{ id: "say", type: "command", position: { x: 0, y: 0 }, command: "true" },
	],
	edges: [],
});

/** Flows as older Night Shifts stored them: `foreach` and `gate` are gone from the format. */
const OLD = {
	top: {
		version: 1,
		params: [{ name: "epic", required: true }],
		start: "loop",
		nodes: [
			{
				id: "loop",
				type: "foreach",
				position: { x: 0, y: 0 },
				source: { kind: "github", parent: "{{params.epic}}" },
				flow: "build",
			},
			{ id: "ask", type: "gate", position: { x: 0, y: 0 }, question: "Go on?" },
		],
		edges: [{ id: "e1", from: "loop", outcome: "done", to: "ask" }],
	},
	// The format before this one: it would fit the schema but for its version.
	build: { ...current, version: FLOW_VERSION - 1 },
};

let sandbox: Sandbox;
let engine: Engine;
let space: SpaceEngine;
let projectId: string;
let engines: Engine[];

function start(options: { scheduler?: false } = {}): Engine {
	const made = createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			dataDir: sandbox.dataDir,
			...options,
		}),
	);
	engines.push(made);
	return made;
}

beforeEach(async () => {
	sandbox = await createSandbox();
	engines = [];
	engine = start();
	space = engine.space(sandbox.spaceId, NIGHT_SHIFT);
	projectId = (await space.addProject({ repoPath: sandbox.repoPath })).id;
});

afterEach(async () => {
	for (const made of engines) await made.dispose();
	await sandbox.cleanup();
});

const push = (
	runId: string,
	type: EngineEventType,
	payload: unknown,
	stepId: string | null = null,
) =>
	appendEvent(
		sandbox.db,
		{ type: type as "RunEnded", runId, stepId, payload: payload as never },
		sandbox.deviceId,
	);

/** A run row, and its start in the log. */
async function putRun(
	id: string,
	flow: unknown,
	bodyFlows: Record<string, unknown> = {},
) {
	await sandbox.db.insert(run).values({
		id,
		spaceId: sandbox.spaceId,
		projectId,
		flowName: "night",
		flow: typeof flow === "string" ? flow : JSON.stringify(flow),
		bodyFlows: JSON.stringify(bodyFlows),
		title: id,
		worktreePath: sandbox.repoPath,
		branch: "main",
		baseRef: "main",
		walkerId: sandbox.deviceId,
	});
	await push(id, "RunStarted", {
		projectId,
		flowName: "night",
		title: id,
		start: "loop",
		inputs: { epic: "7" },
	});
}

/** A step of the run: its row, and its start in the log. */
async function putStep(
	runId: string,
	id: string,
	nodeId: string,
	nodeType: string,
) {
	const transcriptPath = join(sandbox.dataDir, `${id}.ndjson`);
	await sandbox.db.insert(step).values({
		id,
		spaceId: sandbox.spaceId,
		runId,
		nodeId,
		nodeType,
		visit: 1,
		transcriptPath,
	});
	await push(
		runId,
		"StepStarted",
		{ nodeId, nodeType, visit: 1, transcriptPath, logPath: null, scope: null },
		id,
	);
}

/** An old run that ended: a Call with `each` (its flow is only in the snapshot), and an answered Gate. */
async function putEnded(id = "old-ended") {
	await putRun(id, OLD.top, { build: OLD.build, newer: current });
	await putStep(id, `${id}-loop`, "loop", "call");
	await push(
		id,
		"ItemStarted",
		{
			item: { id: "12", title: "first", url: null, value: { id: "12" } },
			index: 1,
			branch: null,
			baseBranch: null,
		},
		`${id}-loop`,
	);
	await push(
		id,
		"ItemEnded",
		{ itemId: "12", state: "done", reason: null },
		`${id}-loop`,
	);
	await push(
		id,
		"StepEnded",
		{
			outcome: "done",
			outputs: { summary: "#12 done" },
			error: null,
			costUsd: 1.5,
		},
		`${id}-loop`,
	);
	await push(id, "RunEnded", { status: "finished", reason: null });
	return id;
}

async function refusalOf(work: Promise<unknown>): Promise<Refusal> {
	const error = await work.then(
		() => null,
		(caught: unknown) => caught,
	);
	if (error instanceof Refusal) return error;
	throw error ?? new Error("Expected a refusal.");
}

const rows = () => sandbox.db.select().from(run).orderBy(run.id);

describe("a run of an older flow", () => {
	test("its page has its steps and an empty flow that says why, with no null", async () => {
		const id = await putEnded();
		const detail = await space.getRun(id);
		expect(detail.flowUnread).toBe("older");
		// What every client of the wire reads: a whole flow of this format.
		expect(flowSchema.parse(detail.flow)).toEqual(detail.flow);
		expect(detail.flow).toMatchObject({ nodes: [], edges: [] });
		expect(Object.keys(detail.calledFlows)).toEqual(["newer"]);
		expect(detail.status).toBe("finished");
		expect(detail.inputs).toEqual({ epic: "7" });
		expect(detail.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["loop", "done"],
		]);
		expect((await space.getStep(id, `${id}-loop`)).items[0]).toMatchObject({
			id: "12",
			title: "first",
		});
	});

	test("a current run says nothing of it, and one that no version reads does not crash", async () => {
		await putRun("now", current);
		await putRun("later", { ...current, version: FLOW_VERSION + 1 });
		await putRun("broken", "{not json");
		expect(await space.getRun("now")).not.toHaveProperty("flowUnread");
		expect((await space.getRun("later")).flowUnread).toBe("newer");
		expect((await space.getRun("broken")).flowUnread).toBe("invalid");
	});

	test("the run list and the dashboards show it", async () => {
		const id = await putEnded();
		const [listed] = await space.listRuns();
		expect(listed).toMatchObject({ id, status: "finished", subflows: [] });
		const at = { now: now(), timeZone: "UTC" };
		const one = { spaceId: sandbox.spaceId, projectId, ...at };
		for (const dashboard of [
			await engine.dashboard.readProjectDashboard(NIGHT_SHIFT, one),
			await engine.dashboard.readSpacesDashboard(NIGHT_SHIFT, {
				spaceIds: [sandbox.spaceId],
				...at,
			}),
		]) {
			expect(JSON.stringify(dashboard)).toContain(id);
		}
	});

	test("it cannot run again, resume or restart, and its record stays as it was", async () => {
		const id = await putEnded();
		const before = await rows();
		const rerun = await refusalOf(
			space.act(id, { kind: "rerun", nodeId: "loop" }),
		);
		// Before the node check: the flow has no nodes to name.
		expect([rerun.kind, rerun.message]).toEqual(["invalid", OLDER_RUN]);
		await putRun("old-failed", OLD.top);
		await push("old-failed", "RunEnded", { status: "failed", reason: "x" });
		const resume = await refusalOf(space.act("old-failed", { kind: "resume" }));
		expect(resume.message).toBe(OLDER_RUN);
		expect((await space.getRun("old-failed")).resumes).toEqual([]);
		expect((await rows()).filter((r) => r.id === id)).toEqual(before);
	});

	test("an open Gate of one refuses its answer with the words, and a stop ends it", async () => {
		await putRun("old-gate", OLD.top);
		await putStep("old-gate", "ask-1", "ask", "decision");
		await push(
			"old-gate",
			"GateOpened",
			{ question: "Go on?", choices: [{ name: "yes" }, { name: "no" }] },
			"ask-1",
		);
		expect((await space.listGates()).map((g) => g.runId)).toEqual(["old-gate"]);
		const answer = await refusalOf(
			space.act("old-gate", {
				kind: "answer",
				stepId: "ask-1",
				choice: "yes",
				note: "",
			}),
		);
		expect(answer.message).toBe(OLDER_RUN);
		expect((await space.getRun("old-gate")).status).toBe("waiting");
		await space.act("old-gate", { kind: "stop" });
		expect((await space.getRun("old-gate")).status).toBe("stopped");
	});

	test("a start ends the open ones interrupted with the reason, and goes on with a new one", async () => {
		await putRun("a-running", OLD.top);
		await putStep("a-running", "running-1", "loop", "call");
		await putRun("b-gate", OLD.build);
		await putStep("b-gate", "gate-1", "ask", "decision");
		await push(
			"b-gate",
			"GateOpened",
			{ question: "Go on?", choices: [{ name: "yes" }] },
			"gate-1",
		);
		const ended = await putEnded();
		await putRun("c-new", current);
		await putStep("c-new", "say-1", "say", "command");
		const before = await rows();
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			const again = start({ scheduler: false }).space(
				sandbox.spaceId,
				NIGHT_SHIFT,
			);
			const list = await waitFor(async () => {
				const runs = await again.listRuns();
				return runs.every((r) => r.status !== "running") ? runs : null;
			});
			const ends = Object.fromEntries(
				list.map((r) => [r.id, [r.status, r.reason]]),
			);
			expect(ends["a-running"]).toEqual(["interrupted", OLDER_RUN]);
			expect(ends["b-gate"]).toEqual(["interrupted", OLDER_RUN]);
			expect(ends[ended]).toEqual(["finished", null]);
			expect(ends["c-new"]?.[0]).toBe("interrupted");
			expect(ends["c-new"]?.[1]).not.toBe(OLDER_RUN);
			const gate = await again.getRun("b-gate");
			expect(gate.steps.map((s) => s.outcome)).toEqual(["interrupted"]);
			expect(await again.listGates()).toEqual([]);
			// A resume by a person says the same, and none of them fails.
			for (const id of ["a-running", "b-gate"]) {
				const resume = await refusalOf(again.act(id, { kind: "resume" }));
				expect(resume.message).toBe(OLDER_RUN);
				expect((await again.getRun(id)).status).toBe("interrupted");
			}
			expect(await rows()).toEqual(before);
		} finally {
			warn.mockRestore();
		}
	});

	test("a batch of another Device with old and broken flows lands as it came", async () => {
		const log = createRunLog(sandbox.db, {
			walkerId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
		});
		const history = createRunHistory({
			db: sandbox.db,
			log,
			bus: createRunBus(),
			dataDir: sandbox.dataDir,
		});
		const row = (id: string, flow: string, bodyFlows: string) => ({
			id,
			spaceId: sandbox.spaceId,
			projectId,
			flowName: "night",
			flow,
			bodyFlows,
			flowRevision: null,
			bodyFlowRevisions: "{}",
			title: id,
			worktreePath: "/x",
			branch: "b",
			baseRef: "main",
			walkerId: "far",
			deviceId: null,
			placements: null,
			deviceNames: null,
			fallbacks: null,
			startedBy: null,
			createdAt: now(),
		});
		const old = JSON.stringify(OLD.top);
		await history.ingest({
			runs: [
				row("far-old", old, JSON.stringify({ build: OLD.build })),
				row("far-new", JSON.stringify(current), "{}"),
				row("far-broken", "{", "{"),
			],
			steps: [],
			sessions: [],
			events: [],
		});
		const [stored] = await sandbox.db
			.select()
			.from(run)
			.where(eq(run.id, "far-old"));
		expect(stored?.flow).toBe(old);
		expect((await space.getRun("far-old")).flowUnread).toBe("older");
		expect(await space.getRun("far-new")).not.toHaveProperty("flowUnread");
		expect((await space.getRun("far-broken")).flowUnread).toBe("invalid");
		expect((await space.listRuns()).map((r) => r.id).sort()).toEqual([
			"far-broken",
			"far-new",
			"far-old",
		]);
	});
});

describe("a current flow that names a device or a profile by its name", () => {
	const byName = [
		{
			id: "device",
			issue:
				"nodes.0.device: A device is named by its id. Choose the device again.",
			nodes: [{ ...current.nodes[0], device: { name: "LE2316" } }],
		},
		{
			id: "profile",
			issue:
				"nodes.0.profile: A profile is named by its device and its id. Pick the profile again.",
			nodes: [
				{
					id: "say",
					type: "agent",
					position: { x: 0, y: 0 },
					prompt: "Say.",
					profile: "worker",
				},
			],
		},
	] as const;

	test.each([...byName])(
		"a run by $id shows, and cannot go on",
		async ({ id, nodes }) => {
			await putRun(id, { ...current, nodes });
			await putStep(id, `${id}-1`, "say", "command");
			await push(id, "RunEnded", { status: "failed", reason: "x" });
			const detail = await space.getRun(id);
			expect(detail.flowUnread).toBe("invalid");
			expect(detail.steps.map((s) => s.nodeId)).toEqual(["say"]);
			expect((await space.listRuns()).map((r) => r.id)).toEqual([id]);
			const resume = await refusalOf(space.act(id, { kind: "resume" }));
			expect(resume.message).toBe(
				"Night Shift cannot read the flow of this run. Start the flow again.",
			);
		},
	);

	test.each([...byName])(
		"an open run by $id ends at a start, never on another device",
		async ({ id, nodes }) => {
			await putRun(id, { ...current, nodes });
			await putStep(id, `${id}-1`, "say", "command");
			const warn = spyOn(console, "warn").mockImplementation(() => {});
			try {
				const again = start({ scheduler: false }).space(
					sandbox.spaceId,
					NIGHT_SHIFT,
				);
				await waitFor(
					async () => (await again.getRun(id)).status !== "running" || null,
				);
				const detail = await again.getRun(id);
				expect(detail.status).toBe("interrupted");
				expect(detail.steps).toHaveLength(1);
			} finally {
				warn.mockRestore();
			}
		},
	);

	test.each([...byName])(
		"a stored flow by $id is listed with what to choose, and does not start",
		async ({ nodes, issue }) => {
			await space.flows.save(projectId, "build", current);
			const documents = createFlowDocuments({ db: sandbox.db });
			const document = await documents.open(projectId);
			for (const value of document.current.doc.getMap("flows").values()) {
				const flow = value as Y.Map<unknown>;
				await document.current.change(() =>
					(flow.get("nodes") as Y.Map<unknown>).set("say", nodes[0]),
				);
			}
			await documents.flush();
			engine = start();
			space = engine.space(sandbox.spaceId, NIGHT_SHIFT);
			expect((await space.flows.list(projectId)).map((f) => f.name)).toEqual([
				"build",
			]);
			expect(await space.flows.get(projectId, "build")).toMatchObject({
				flow: null,
				issues: [{ severity: "error", message: issue }],
			});
			const refused = await refusalOf(
				space.startRun({ projectId, flowName: "build" }),
			);
			expect(refused.message).toContain(issue);
			expect(await space.listRuns()).toEqual([]);
		},
	);
});

describe("a flow of an older format", () => {
	/** Stores `build` in the format before this one, as that Night Shift left it. */
	async function putOlder() {
		await space.flows.save(projectId, "build", current);
		await space.flows.save(projectId, "caller", {
			...current,
			start: "call",
			nodes: [
				{
					id: "call",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "build",
					inputs: {},
				},
			],
		});
		const documents = createFlowDocuments({ db: sandbox.db });
		const document = await documents.open(projectId);
		const flows = document.current.doc.getMap("flows");
		for (const [flowId, value] of flows.entries()) {
			const flow = value as Y.Map<unknown>;
			if (flow.get("name") !== "build") continue;
			await document.current.change(() =>
				flow.set("version", FLOW_VERSION - 1),
			);
			await document.history.change(() => {
				const list = document.history.doc.getArray<object>(flowId);
				const last = list.get(0);
				list.delete(0, 1);
				list.push([{ ...last, flow: OLD.build }]);
			});
		}
		await documents.flush();
		// A new engine reads the documents as they are stored.
		engine = start();
		space = engine.space(sandbox.spaceId, NIGHT_SHIFT);
	}

	const stored = async () => {
		const documents = createFlowDocuments({ db: sandbox.db });
		const document = await documents.open(projectId);
		const json = JSON.stringify([
			document.current.doc.getMap("flows").toJSON(),
			[...document.history.doc.share.keys()].map((key) =>
				document.history.doc.getArray(key).toJSON(),
			),
		]);
		await documents.flush();
		return json;
	};

	test("is listed, refuses to start, to change and to restore, and stays as it is", async () => {
		await putOlder();
		const before = await stored();
		expect(
			(await space.flows.list(projectId)).map((f) => [f.name, f.nodeCount]),
		).toEqual([
			["build", null],
			["caller", 1],
		]);
		expect(await space.flows.get(projectId, "build")).toMatchObject({
			flow: null,
			issues: [{ severity: "error", message: OLDER_FLOW }],
		});
		const start = await refusalOf(
			space.startRun({ projectId, flowName: "build" }),
		);
		expect(start.kind).toBe("invalid");
		expect(start.message).toContain(OLDER_FLOW);
		const caller = await refusalOf(
			space.startRun({ projectId, flowName: "caller" }),
		);
		expect(caller.kind).toBe("invalid");
		const save = await refusalOf(space.flows.save(projectId, "build", current));
		expect(save.kind).toBe("conflict");

		const [revision] = await space.flows.revisions(projectId, "build");
		expect(revision).toMatchObject({ kind: "save", changes: null });
		const view = await space.flows.revision(
			projectId,
			"build",
			revision?.id ?? "",
		);
		expect([view.revision.flow, view.diff]).toEqual([null, null]);
		const restore = await refusalOf(
			space.flows.restore(projectId, "build", revision?.id ?? ""),
		);
		expect(restore.message).toBe(`${OLDER_FLOW} You cannot restore it.`);
		await refusalOf(space.flows.export(projectId, "build"));
		expect(await stored()).toBe(before);
	});

	test("a schedule of it stays and starts nothing", async () => {
		await putOlder();
		const nightly = {
			id: "nightly",
			flow: "build",
			inputs: {},
			cron: "0 3 * * *",
			enabled: true,
		};
		const issues = await space.saveSchedules(projectId, [nightly]);
		expect(issues).toMatchObject([
			{ severity: "error", scheduleId: "nightly" },
		]);
		const fired = await refusalOf(space.runScheduleNow(projectId, "nightly"));
		expect(fired.message).toContain(OLDER_FLOW);
		expect((await space.listSchedules(projectId)).schedules).toHaveLength(1);
		expect(await space.listRuns()).toEqual([]);
	});

	test("a file of one is not imported, and a quick run of one does not start", async () => {
		const refused = await refusalOf(
			space.flows.import(projectId, "old", JSON.stringify(OLD.top)),
		);
		expect(refused.message).toBe(
			"An older version of Night Shift made this file. Night Shift cannot import it.",
		);
		const quick = await refusalOf(
			space.startRun({ projectId, flow: OLD.build as typeof current }),
		);
		expect(quick.message).toContain(OLDER_FLOW);
		expect(await space.flows.list(projectId)).toEqual([]);
	});

	test("a person may delete it", async () => {
		await putOlder();
		await space.flows.remove(projectId, "build");
		expect((await space.flows.list(projectId)).map((f) => f.name)).toEqual([
			"caller",
		]);
	});
});
