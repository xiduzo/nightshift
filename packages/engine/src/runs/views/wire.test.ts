import { expect, test } from "bun:test";
import { project, run } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import { createRunBus, createRunLog } from "../../log";
import { ownDevice } from "../../testing/alone-directory";
import { localSpaceId } from "../../testing/test-support";
import { wireViews } from "./wire";

const unused = () => {
	throw new Error("This call asks no neighbour.");
};

test("readRunTrace gives the run of its id, over the database and the run log", async () => {
	const db = await migratedDb();
	const deviceId = (await ownDevice(db)).id;
	const spaceId = await localSpaceId(db);
	const log = createRunLog(db, { walkerId: deviceId, dataDir: "/nowhere" });
	await db.insert(project).values({ id: "p", spaceId, name: "p" });
	for (const id of ["r1", "r2"]) {
		await db.insert(run).values({
			id,
			spaceId,
			projectId: "p",
			flow: "{}",
			title: id,
			worktreePath: "",
			branch: "",
			baseRef: "",
			walkerId: deviceId,
			createdAt: asDate(1_000),
		});
		await log.append({
			type: "RunStarted",
			runId: id,
			payload: { projectId: "p", flowName: "f", title: id, start: "a" },
		});
	}
	const views = wireViews({
		db,
		log,
		bus: createRunBus(),
		deviceId,
		harnessOf: () => undefined,
		walkers: unused,
		pendingCommands: unused,
		stepEntries: unused,
		ownEntries: unused,
		pathsFor: unused,
		access: { openRun: unused, openSpace: unused },
	});
	expect(await views.readRunTrace({ runId: "r2" })).toMatchObject({
		runId: "r2",
	});
	expect(await views.readRunTrace({ runId: "nobody-has-it" })).toBeNull();
});
