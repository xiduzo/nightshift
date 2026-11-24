import { describe, expect, test } from "bun:test";
import type { Refusal } from "@nightshift/refusal";
import { NIGHT_SHIFT } from "../../contract";
import { inMemoryAccess } from "../adapters/out/in-memory-access";
import { runRecord } from "../adapters/out/in-memory-run-records";
import { RunNotFound } from "../domain/refusals";
import { openRun } from "./open-run";

/** Opening a run for an actor, on in-memory adapters. */

const SPACE = "space-1";
const OTHER = "space-2";
const ADA = { personId: "person-ada", door: "session" as const };

/** Ports with one run in `SPACE`, walked here, and one in `OTHER`, walked elsewhere. */
function setup() {
	const ports = inMemoryAccess();
	ports.runs.add(runRecord({ id: "run-1", spaceId: SPACE }));
	ports.runs.add(
		runRecord({ id: "run-2", spaceId: OTHER, walkerId: "device-far" }),
	);
	return { ports, open: openRun(ports) };
}

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

describe("openRun", () => {
	test("Night Shift opens any run, with where it is walked", async () => {
		const { open } = setup();
		const here = await open(NIGHT_SHIFT, { runId: "run-1" });
		expect(here.run.id).toBe("run-1");
		expect(here.walkedHere).toBe(true);
		const far = await open(NIGHT_SHIFT, { runId: "run-2" });
		expect(far.walkedHere).toBe(false);
	});

	test("a run this Replica does not have is not found", async () => {
		const { open } = setup();
		const refused = await refusalOf(open(NIGHT_SHIFT, { runId: "run-gone" }));
		expect(refused).toBeInstanceOf(RunNotFound);
		expect((refused as Refusal).kind).toBe("not-found");
		expect((refused as Refusal).message).toBe(
			"Night Shift cannot find this run.",
		);
	});

	test("a Space sees only its own runs: a run of another Space is not found", async () => {
		const { open } = setup();
		expect(
			await refusalOf(open(NIGHT_SHIFT, { runId: "run-2", spaceId: SPACE })),
		).toBeInstanceOf(RunNotFound);
		const own = await open(NIGHT_SHIFT, { runId: "run-1", spaceId: SPACE });
		expect(own.run.spaceId).toBe(SPACE);
	});

	test("a Person who is not a Member of the run's Space does not find it", async () => {
		const { ports, open } = setup();
		ports.members.join(OTHER, ADA.personId, "owner");
		expect(await refusalOf(open(ADA, { runId: "run-1" }))).toBeInstanceOf(
			RunNotFound,
		);
		expect((await open(ADA, { runId: "run-2" })).run.id).toBe("run-2");
	});

	test("a Member opens the run; one whose role does not allow the need is refused", async () => {
		const { ports, open } = setup();
		ports.members.join(SPACE, ADA.personId, "viewer");
		expect((await open(ADA, { runId: "run-1" })).run.id).toBe("run-1");
		const refused = await refusalOf(
			open(ADA, { runId: "run-1", need: { run: ["stop"] } }),
		);
		expect(refused).toBeInstanceOf(ports.RoleRefusal);
		expect((refused as Refusal).kind).toBe("forbidden");
		expect((refused as Refusal).message).toBe(
			"Your role in this Space does not allow this. Ask an owner or admin of the Space to change your role.",
		);
	});

	test("a Member whose role allows the need opens the run", async () => {
		const { ports, open } = setup();
		ports.members.join(SPACE, ADA.personId, "member");
		const opened = await open(ADA, {
			runId: "run-1",
			spaceId: SPACE,
			need: { run: ["stop"] },
		});
		expect(opened).toEqual({
			run: runRecord({ id: "run-1", spaceId: SPACE }),
			walkedHere: true,
		});
	});

	test("a Command's Person is read from the Space document", async () => {
		const { ports, open } = setup();
		ports.members.join(SPACE, ADA.personId, "member", ["document"]);
		const byCommand = { ...ADA, door: "command" as const };
		expect((await open(byCommand, { runId: "run-1" })).run.id).toBe("run-1");
		expect(await refusalOf(open(ADA, { runId: "run-1" }))).toBeInstanceOf(
			RunNotFound,
		);
	});
});
