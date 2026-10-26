import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { project, run } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";

import {
	createRunBus,
	createRunLog,
	getRunRow,
	type RunBus,
	type RunLog,
} from "../log";
import type { EventInput } from "../log/events";
import { createSandbox, type Sandbox } from "../testing/test-support";
import * as derivedSteps from "./derive-steps";
import { createReadModel, type ReadModel } from "./read-model";
import type { RunStreamItem } from "./views";

/*
 * The read model's reads of a run share the run log's derivations: every
 * watcher of a run, and the run page, derive the run's steps once per
 * append between them.
 */

let sandbox: Sandbox;
let log: RunLog;
let bus: RunBus;
let reads: ReadModel;
const controllers: AbortController[] = [];

beforeEach(async () => {
	sandbox = await createSandbox();
	await sandbox.db
		.insert(project)
		.values({ id: "p", spaceId: sandbox.spaceId, name: "p" });
	await sandbox.db.insert(run).values({
		id: "r1",
		spaceId: sandbox.spaceId,
		projectId: "p",
		flow: "{}",
		title: "r1",
		worktreePath: "/w",
		branch: "b",
		baseRef: "main",
		walkerId: sandbox.deviceId,
	});
	log = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
	bus = createRunBus();
	reads = createReadModel({
		db: sandbox.db,
		log,
		bus,
		deviceId: sandbox.deviceId,
		harnessOf: () => undefined,
		walkers: async (_spaceId, ids) =>
			new Map(ids.map((id) => [id, { id, name: null, thisDevice: true }])),
		pendingCommands: async () => new Map(),
		stepEntries: async function* () {},
	});
	await log.append({
		type: "RunStarted",
		runId: "r1",
		payload: { projectId: "p", flowName: "f", title: "t", start: "a" },
	});
});

afterEach(async () => {
	for (const controller of controllers.splice(0)) controller.abort();
	await sandbox.cleanup();
});

const stepStarted = (stepId: string): EventInput<"StepStarted"> => ({
	type: "StepStarted",
	runId: "r1",
	stepId,
	payload: {
		nodeId: "a",
		nodeType: "agent",
		visit: 1,
		transcriptPath: `/t/${stepId}`,
		logPath: null,
	},
});

/** Watches the run in the background, keeping what it sends. */
async function watcher() {
	const controller = new AbortController();
	controllers.push(controller);
	const items: RunStreamItem[] = [];
	const row = await getRunRow(sandbox.db, "r1");
	void (async () => {
		for await (const item of reads.watch(row, controller.signal, 0)) {
			items.push(item);
		}
	})();
	return items;
}

async function until(done: () => boolean) {
	for (let tries = 0; !done(); tries++) {
		if (tries > 400) throw new Error("It did not happen in time.");
		await Bun.sleep(5);
	}
}

const sentStep = (items: RunStreamItem[], stepId: string) =>
	items.some((item) => item.kind === "step" && item.step.id === stepId);

describe("the read model", () => {
	test("every watcher of a run shares one derivation of its steps per append", async () => {
		const watchers = await Promise.all(
			Array.from({ length: 4 }, () => watcher()),
		);
		await until(() =>
			watchers.every((items) => items.some((i) => i.kind === "status")),
		);
		const derive = spyOn(derivedSteps, "deriveSteps");
		try {
			for (const stepId of ["s1", "s2", "s3"]) {
				derive.mockClear();
				await log.append(stepStarted(stepId));
				bus.publish("r1", { kind: "step-changed", stepId });
				await until(() => watchers.every((items) => sentStep(items, stepId)));
				// Each watcher's transcript reader reads the steps too.
				await Bun.sleep(20);
				expect(derive).toHaveBeenCalledTimes(1);
			}
		} finally {
			derive.mockRestore();
		}
	});

	test("the run page shows the steps the run log keeps", async () => {
		await log.append(stepStarted("s1"));
		const detail = await reads.getRun(await getRunRow(sandbox.db, "r1"));
		expect(detail.steps.map((s) => s.id)).toEqual(["s1"]);
		expect(detail.status).toBe("running");
	});

	test("a run's status and place come from one row and the run log", async () => {
		expect(await reads.runHere("r1")).toEqual({
			id: "r1",
			status: "running",
			wakeAt: null,
			walkedHere: true,
			stepsHere: true,
		});
		expect(await reads.runHere("missing")).toBeNull();
	});

	test("a run list pages by limit and cursor, newest first", async () => {
		// r1 is the oldest; r2 and r3 start at the same time, so the id orders them.
		await sandbox.db
			.update(run)
			.set({ createdAt: new Date(1_000) })
			.where(eq(run.id, "r1"));
		for (const id of ["r2", "r3", "r4"]) {
			await sandbox.db.insert(run).values({
				id,
				spaceId: sandbox.spaceId,
				projectId: "p",
				flow: "{}",
				title: id,
				worktreePath: "/w",
				branch: "b",
				baseRef: "main",
				walkerId: sandbox.deviceId,
				createdAt: new Date(id === "r4" ? 3_000 : 2_000),
			});
		}
		const ids = (runs: { id: string }[]) => runs.map((r) => r.id);
		const all = await reads.listRuns(sandbox.spaceId);
		expect(ids(all)).toEqual(["r4", "r3", "r2", "r1"]);

		const first = await reads.listRuns(sandbox.spaceId, undefined, {
			limit: 2,
		});
		expect(ids(first)).toEqual(["r4", "r3"]);
		const last = first.at(-1);
		if (!last) throw new Error("No page.");
		const second = await reads.listRuns(sandbox.spaceId, "p", {
			limit: 2,
			cursor: { createdAt: last.createdAt, id: last.id },
		});
		expect(ids(second)).toEqual(["r2", "r1"]);
		expect(second[1]?.status).toBe("running");

		// Only r1 has events of a running run.
		const running = await reads.listRuns(sandbox.spaceId, undefined, {
			limit: 1,
			statuses: ["running"],
		});
		expect(ids(running)).toEqual(["r1"]);
	});

	test("each project's runs come counted by status, with the newest run", async () => {
		await sandbox.db
			.insert(project)
			.values({ id: "q", spaceId: sandbox.spaceId, name: "q" });
		await sandbox.db.insert(run).values({
			id: "r2",
			spaceId: sandbox.spaceId,
			projectId: "p",
			flow: "{}",
			title: "Second",
			worktreePath: "/w",
			branch: "b",
			baseRef: "main",
			walkerId: sandbox.deviceId,
			createdAt: new Date(Date.now() + 60_000),
		});
		await log.append({
			type: "RunStarted",
			runId: "r2",
			payload: { projectId: "p", flowName: "f", title: "t", start: "a" },
		});
		await log.append({
			type: "RunEnded",
			runId: "r2",
			payload: { status: "finished", reason: null },
		});
		const counts = await reads.projectRuns(sandbox.spaceId);
		expect(counts.get("p")).toMatchObject({
			total: 2,
			statuses: { running: 1, finished: 1 },
			last: { id: "r2", title: "Second" },
			nextWakeAt: null,
		});
		// A project without runs is not in it.
		expect(counts.has("q")).toBe(false);
	});
});
