import { beforeEach, describe, expect, test } from "bun:test";
import { project } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { createRunLog } from "../../../../log";
import { localSpaceId } from "../../../../testing/test-support";
import { drizzleRemovalLog } from "./drizzle-removal-log";

const make = async () => {
	const db = await migratedDb();
	const spaceId = await localSpaceId(db);
	for (const id of ["p1", "p2"]) {
		await db.insert(project).values({ id, spaceId, name: id });
	}
	const log = createRunLog(db, { walkerId: "here", dataDir: "/nowhere" });
	return {
		removalLog: drizzleRemovalLog({ db: db, log }),
	};
};

describe("RemovalLog over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	beforeEach(async () => {
		under = await make();
	});

	test("a project with no removal has none", async () => {
		expect(await under.removalLog.removals("p1")).toEqual([]);
	});

	test("gives the project's removals oldest first, each with its run and who removed it", async () => {
		const { removalLog } = under;
		await removalLog.removed({
			projectId: "p1",
			runId: "run-1",
			worktreePath: "/work/run-1",
			branches: ["nightshift/run-1"],
			kept: ["refs/nightshift/kept/run-1/copy"],
			by: "cleanup",
		});
		await removalLog.removed({
			projectId: "p2",
			runId: "run-2",
			worktreePath: null,
			branches: [],
			by: "cleanup",
		});
		await removalLog.removed({
			projectId: "p1",
			runId: "run-3",
			worktreePath: null,
			branches: [],
			expired: ["refs/nightshift/kept/run-3/copy"],
			by: "person",
		});
		const removals = await removalLog.removals("p1");
		expect(removals.map(({ runId, by }) => ({ runId, by }))).toEqual([
			{ runId: "run-1", by: "cleanup" },
			{ runId: "run-3", by: "person" },
		]);
		for (const removal of removals) {
			expect(typeof removal.at).toBe("number");
		}
		const [first, second] = removals;
		expect(first && second && first.at <= second.at).toBe(true);
		expect(
			(await removalLog.removals("p2")).map((removal) => removal.runId),
		).toEqual(["run-2"]);
	});
});
