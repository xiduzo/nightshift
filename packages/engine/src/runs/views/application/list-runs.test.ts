import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { NIGHT_SHIFT } from "../../../contract";
import { runRecord } from "../../access/adapters/out/in-memory-run-records";
import { inMemoryViewsPorts } from "../adapters/out/in-memory-neighbours";
import { listRuns } from "./list-runs";

/** The runs of a Space for an actor, on in-memory adapters. */

const SPACE = "space-1";
const OTHER = "space-2";
const ADA = { personId: "person-ada" };

/** Three runs: two of `SPACE` (one on Ada's Device, one on another), one of `OTHER`. */
function setup() {
	const ports = inMemoryViewsPorts();
	ports.addRun(
		runRecord({
			id: "run-1",
			spaceId: SPACE,
			worktreePath: "/work/1",
			deviceId: "ada-laptop",
			createdAt: asDate(1_000),
		}),
	);
	ports.addRun(
		runRecord({
			id: "run-2",
			spaceId: SPACE,
			projectId: "project-2",
			worktreePath: "/work/2",
			deviceId: "studio",
			createdAt: asDate(2_000),
		}),
	);
	ports.addRun(runRecord({ id: "run-3", spaceId: OTHER }));
	ports.paths.own("ada-laptop", ADA.personId);
	return { ports, list: listRuns(ports) };
}

const ids = (runs: { id: string }[]) => runs.map((r) => r.id);

describe("listRuns", () => {
	test("Night Shift lists the runs of the Space, newest first, with every path", async () => {
		const { list } = setup();
		const runs = await list(NIGHT_SHIFT, { spaceId: SPACE });
		expect(ids(runs)).toEqual(["run-2", "run-1"]);
		expect(runs.map((r) => r.worktreePath)).toEqual(["/work/2", "/work/1"]);
	});

	test("a Member sees the path of a run only on a Device they own", async () => {
		const { ports, list } = setup();
		ports.access.members.join(SPACE, ADA.personId, "viewer");
		const runs = await list(ADA, { spaceId: SPACE });
		expect(runs.map((r) => [r.id, r.worktreePath])).toEqual([
			["run-2", ""],
			["run-1", "/work/1"],
		]);
		expect(ports.paths.asked).toEqual([{ spaceId: SPACE, actor: ADA }]);
	});

	test("a Space the Person is not a Member of is not found", async () => {
		const { ports, list } = setup();
		ports.access.members.join(OTHER, ADA.personId, "owner");
		await expect(list(ADA, { spaceId: SPACE })).rejects.toMatchObject({
			kind: "not-found",
			message: "That Space does not exist.",
		});
		expect(ids(await list(ADA, { spaceId: OTHER }))).toEqual(["run-3"]);
	});

	test("one project, a page at a time", async () => {
		const { list } = setup();
		expect(
			ids(await list(NIGHT_SHIFT, { spaceId: SPACE, projectId: "project-2" })),
		).toEqual(["run-2"]);
		expect(ids(await list(NIGHT_SHIFT, { spaceId: SPACE, limit: 1 }))).toEqual([
			"run-2",
		]);
		const next = await list(NIGHT_SHIFT, {
			spaceId: SPACE,
			limit: 1,
			cursor: { createdAt: 2_000, id: "run-2" },
		});
		expect(ids(next)).toEqual(["run-1"]);
	});
});
