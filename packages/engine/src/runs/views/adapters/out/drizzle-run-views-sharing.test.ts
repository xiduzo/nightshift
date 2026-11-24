import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Database } from "@nightshift/db";
import { project, run } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import {
	createRunBus,
	createRunLog,
	getRunRow,
	type RunBus,
	type RunLog,
} from "../../../../log";
import type { RunStreamItem } from "../../../../read";
import * as derivedSteps from "../../../../read/run-views";
import { ownDevice } from "../../../../testing/alone-directory";
import { localSpaceId } from "../../../../testing/test-support";
import type { RunViews } from "../../application/ports";
import { drizzleRunViews } from "./drizzle-run-views";

/*
 * What only the views over the run log do: the reads of a run share the
 * run log's derivations. Every watcher of a run, and the run page, derive
 * the run's steps once per append between them. What the views read is in
 * `drizzle-run-views.test.ts`.
 */

let db: Database;
let log: RunLog;
let bus: RunBus;
let views: RunViews;
const controllers: AbortController[] = [];

beforeEach(async () => {
	db = await migratedDb();
	const deviceId = (await ownDevice(db)).id;
	const spaceId = await localSpaceId(db);
	await db.insert(project).values({ id: "p", spaceId, name: "p" });
	await db.insert(run).values({
		id: "r1",
		spaceId,
		projectId: "p",
		flow: "{}",
		title: "r1",
		worktreePath: "/w",
		branch: "b",
		baseRef: "main",
		walkerId: deviceId,
	});
	log = createRunLog(db, { walkerId: deviceId, dataDir: "/nowhere" });
	bus = createRunBus();
	views = drizzleRunViews({
		db,
		log,
		bus,
		deviceId,
		harnessOf: () => undefined,
		walkers: async (_spaceId, ids) =>
			new Map(ids.map((id) => [id, { id, name: null, thisDevice: true }])),
		pendingCommands: async () => new Map(),
		stepEntries: async function* () {},
		ownEntries: async () => [],
	});
	await log.append({
		type: "RunStarted",
		runId: "r1",
		payload: { projectId: "p", flowName: "f", title: "t", start: "a" },
	});
});

afterEach(() => {
	for (const controller of controllers.splice(0)) controller.abort();
});

/** Watches the run in the background, keeping what it sends. */
async function watcher() {
	const controller = new AbortController();
	controllers.push(controller);
	const items: RunStreamItem[] = [];
	const row = await getRunRow(db, "r1");
	void (async () => {
		for await (const item of views.watch(row, controller.signal, 0)) {
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

describe("the views over the run log", () => {
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
				await log.append({
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
});
