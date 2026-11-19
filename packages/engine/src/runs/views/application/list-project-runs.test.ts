import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { NIGHT_SHIFT } from "../../../contract";
import { runRecord } from "../../access/adapters/out/in-memory-run-records";
import { inMemoryViewsPorts } from "../adapters/out/in-memory-neighbours";
import { listProjectRuns } from "./list-project-runs";

/** How the runs of each project stand, for an actor, on in-memory adapters. */

const SPACE = "space-1";
const ADA = { personId: "person-ada" };
const AT = 10 * 86_400_000;

function setup() {
	const ports = inMemoryViewsPorts();
	ports.addRun(
		runRecord({ id: "run-1", spaceId: SPACE, createdAt: asDate(AT - 1_000) }),
	);
	ports.addRun(
		runRecord({
			id: "run-2",
			spaceId: SPACE,
			title: "Second",
			createdAt: asDate(AT),
		}),
	);
	ports.addRun(runRecord({ id: "run-3", spaceId: "space-2" }));
	ports.views.append({
		type: "RunStarted",
		runId: "run-2",
		payload: { projectId: "project-1", flowName: "f", title: "t", start: "a" },
	});
	return { ports, list: listProjectRuns(ports) };
}

describe("listProjectRuns", () => {
	test("each project of the Space with its runs counted and its newest run", async () => {
		const { list } = setup();
		const counts = await list(NIGHT_SHIFT, {
			spaceId: SPACE,
			read: { now: AT, timeZone: "UTC" },
		});
		expect([...counts.keys()]).toEqual(["project-1"]);
		expect(counts.get("project-1")).toMatchObject({
			total: 2,
			last: { id: "run-2", title: "Second" },
		});
	});

	test("a Member reads them; a Person who is not one does not find the Space", async () => {
		const { ports, list } = setup();
		await expect(list(ADA, { spaceId: SPACE })).rejects.toMatchObject({
			kind: "not-found",
		});
		ports.access.members.join(SPACE, ADA.personId, "viewer");
		expect((await list(ADA, { spaceId: SPACE })).size).toBe(1);
	});
});
