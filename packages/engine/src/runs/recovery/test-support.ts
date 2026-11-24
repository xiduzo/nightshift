import type { Database } from "@nightshift/db";
import { project, run } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { FLOW_VERSION } from "@nightshift/flows";
import {
	createRunBus,
	createRunLog,
	type EngineEventType,
	type EnginePayloads,
} from "../../log";
import { appendEvent } from "../../testing/append-event";
import { localSpaceId } from "../../testing/test-support";
import {
	type DrizzleOpenWorkDeps,
	drizzleOpenWork,
} from "./adapters/out/drizzle-open-work";
import { drizzleWaits } from "./adapters/out/drizzle-waits";
import { inMemoryRecoveryPorts } from "./adapters/out/in-memory-neighbours";
import type { OpenWork } from "./application/ports";

/** The Walker of the runs of this computer. */
export const HERE = "this-computer";
/** The Device that walks the runs a test puts elsewhere. */
export const FAR = "device-far";

/** The flow of each run: one agent node, the step `s1` of a test. */
const FLOW = JSON.stringify({
	version: FLOW_VERSION,
	start: "a",
	nodes: [{ id: "a", type: "agent", prompt: "work" }],
	edges: [],
});

/** One event of a run's log, as a test writes it. */
export type EventSpec = {
	type: EngineEventType;
	payload: unknown;
	stepId?: string | null;
	sessionId?: string | null;
};

/** Appends one event to a run's log, as its Walker. */
function put(db: Database, runId: string, e: EventSpec, walkerId: string) {
	return appendEvent(
		db,
		{
			runId,
			type: e.type,
			payload: e.payload as EnginePayloads[EngineEventType],
			stepId: e.stepId ?? null,
			sessionId: e.sessionId ?? null,
		},
		walkerId,
	);
}

/** A database in memory with two projects, and the run log of this computer: what recovery's stores stand on. */
export async function recoveryGround() {
	const db = await migratedDb();
	const spaceId = await localSpaceId(db);
	await db.insert(project).values([
		{ id: "project-1", spaceId, name: "one", folder: false },
		{ id: "project-2", spaceId, name: "two", folder: false },
	]);
	const log = createRunLog(db, { walkerId: HERE, dataDir: "/nowhere" });
	/** The runs that let go of what they hold, in order. */
	const letGone: string[] = [];
	return {
		/** What the two stores stand on. */
		deps: {
			db,
			log,
			bus: createRunBus(),
			// The snapshot as stored. The engine reads it with `parseRunFlow`.
			flowOf: (row) => JSON.parse(row.flow),
			calledFlowsOf: (row) => JSON.parse(row.bodyFlows),
			runHolds: {
				ended: async () => {},
				notContinuing: async (runId) => {
					letGone.push(runId);
				},
				resuming: async () => {},
			},
		} satisfies DrizzleOpenWorkDeps,
		letGone,
		/** A run of a project. By default this computer walks it, and wrote its log. */
		async addRun(
			id: string,
			events: readonly EventSpec[],
			given: { projectId?: string; walkerId?: string; writer?: string } = {},
		) {
			const walkerId = given.walkerId ?? HERE;
			await db.insert(run).values({
				id,
				spaceId,
				projectId: given.projectId ?? "project-1",
				flow: FLOW,
				bodyFlows: "{}",
				title: id,
				worktreePath: "",
				branch: "",
				baseRef: "",
				walkerId,
			});
			for (const e of events) await put(db, id, e, given.writer ?? walkerId);
		},
		/** The run's Walker of before writes the move to this computer: the run has not arrived. */
		moveHere: (runId: string) =>
			put(
				db,
				runId,
				{ type: "WalkerMoved", payload: { from: FAR, to: HERE, by: null } },
				FAR,
			),
	};
}

/** Every port of recovery: its stores over a database in memory, which record what they did, and the others in memory. Where each use-case test starts. */
export async function recoveryPorts() {
	const { deps, letGone, addRun } = await recoveryGround();
	const store = drizzleOpenWork(deps);
	const openWork = {
		...store,
		/** How often the checkpoints were pruned. */
		pruned: 0,
		/** Each cut, in order. */
		closed: [] as { runId: string; reason: string }[],
		letGone,
		async pruneCheckpoints() {
			await store.pruneCheckpoints();
			openWork.pruned++;
		},
		async close(runId: string, cut: Parameters<OpenWork["close"]>[1]) {
			await store.close(runId, cut);
			openWork.closed.push({ runId, reason: cut.reason });
		},
	};
	return {
		...inMemoryRecoveryPorts(),
		openWork,
		waits: drizzleWaits(deps),
		addRun,
	};
}
