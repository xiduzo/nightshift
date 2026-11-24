import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, type Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { atLocal, utc } from "@nightshift/time/testing";
import { allowing } from "../../access/adapters/out/in-memory-access";
import { createScheduleWatch } from "../domain/schedule-watch";
import { createWebhookRefusals } from "../domain/webhook-delivery";
import { schedulePorts } from "../test-support";
import { listSchedules } from "./list-schedules";

/** The schedules of a project as a person reads them, over a database in memory. */

/** Local time on the computer's clock, October 2026 (the 16th is a Friday). */
function at(day: number, hours: number, minutes = 0, seconds = 0): number {
	return atLocal(2026, 9, day, hours, minutes, seconds);
}

const P = "project-1";
const SPACE = "space-1";
const ANN = { personId: "person-ann", door: "session" as const };
// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
const HOOK_SECRET = "${HOOK_SECRET}";
const night: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "work",
	nodes: [
		{
			id: "work",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo night",
			stdout: "text",
		},
	],
	edges: [],
};

function nightly(extra: Partial<Schedule> = {}): Schedule {
	return {
		id: "nightly",
		flow: "night",
		inputs: {},
		cron: "0 22 * * *",
		enabled: true,
		...extra,
	};
}

/** A project in a Space with `schedules`, at `now`, and the list of it. */
async function project(schedules: Schedule[], now = at(16, 21, 59)) {
	const ports = await schedulePorts(now);
	for (const spaceId of [SPACE, "space-2"]) {
		ports.access.members.join(spaceId, ANN.personId, "member");
	}
	ports.projects.add({ id: P, spaceId: SPACE });
	ports.store.seed(P, { flows: { night: { json: night } }, schedules });
	const watch = createScheduleWatch(now);
	const refusals = createWebhookRefusals();
	const list = listSchedules({ ...ports, watch, refusals });
	return {
		ports,
		watch,
		refusals,
		listAs: list,
		list: () => list(ANN, { spaceId: SPACE, projectId: P }),
		listIn: (spaceId: string, projectId = P) =>
			list(ANN, { spaceId, projectId }),
	};
}

describe("the schedules of a project", () => {
	test("each has its next start, its last result with the run's status now, and its issues", async () => {
		const stops = nightly({ stopAt: "07:00" });
		const { ports, list } = await project([stops]);
		expect((await list()).schedules[0]?.nextAt).toBe(at(16, 22));

		await ports.log.fired({
			projectId: P,
			scheduleId: "nightly",
			at: at(16, 22),
			runId: "run-1",
			error: null,
		});
		ports.runs.setStatus("run-1", "finished");
		ports.clock.set(at(16, 22, 0, 40));
		expect(await list()).toEqual({
			path: "schedules",
			schedules: [
				{
					...stops,
					nextAt: at(17, 22),
					last: {
						kind: "fired",
						at: at(16, 22),
						runId: "run-1",
						runStatus: "finished",
					},
					deliveries: [],
					issues: [],
				},
			],
			issues: [],
		});
	});

	test("the run's own start counts as the last result when the daemon died before the fired fact", async () => {
		const { ports, list } = await project([nightly()], at(16, 22, 3));
		await ports.runStarted({
			projectId: P,
			scheduleId: "nightly",
			at: at(16, 22),
			runId: "cut-short",
		});
		ports.runs.setStatus("cut-short", "interrupted");
		expect((await list()).schedules[0]?.last).toEqual({
			kind: "fired",
			at: at(16, 22),
			runId: "cut-short",
			runStatus: "interrupted",
		});
	});

	test("a run that is gone has no status", async () => {
		const { ports, list } = await project([nightly()]);
		await ports.log.fired({
			projectId: P,
			scheduleId: "nightly",
			at: at(15, 22),
			runId: "gone",
			error: null,
		});
		expect((await list()).schedules[0]?.last).toMatchObject({
			kind: "fired",
			runId: "gone",
			runStatus: null,
		});
	});

	test("a skipped time is the last result, and the next start is the next evening", async () => {
		const { ports, list } = await project([nightly()], at(17, 22, 30));
		await ports.log.skipped({
			projectId: P,
			scheduleId: "nightly",
			at: at(17, 22),
			reason: "Missed by 30 min.",
			runId: null,
		});
		const [listed] = (await list()).schedules;
		expect(listed?.last).toEqual({
			kind: "skipped",
			at: at(17, 22),
			reason: "Missed by 30 min.",
			runId: null,
		});
		expect(listed?.nextAt).toBe(at(18, 22));
	});

	test("a start that failed is the last result, with its words", async () => {
		const { ports, list } = await project([nightly({ flow: "gone" })]);
		await ports.log.fired({
			projectId: P,
			scheduleId: "nightly",
			at: at(16, 22),
			runId: null,
			error: 'The flow "gone" does not exist.',
		});
		ports.clock.set(at(16, 22, 1));
		const [listed] = (await list()).schedules;
		expect(listed?.last).toEqual({
			kind: "failed",
			at: at(16, 22),
			error: 'The flow "gone" does not exist.',
		});
		expect(listed?.issues).toEqual([
			{
				severity: "error",
				message: 'The flow "gone" does not exist.',
				scheduleId: "nightly",
			},
		]);
	});

	test("a schedule added after its time has no last result, and starts the next evening", async () => {
		const { list } = await project([nightly()], at(16, 23));
		const [listed] = (await list()).schedules;
		expect(listed?.last).toBeNull();
		expect(listed?.nextAt).toBe(at(17, 22));
	});

	test("a time that is due and still starts is the next start", async () => {
		const { ports, list } = await project([nightly()]);
		ports.clock.set(at(16, 22, 1));
		expect((await list()).schedules[0]?.nextAt).toBe(at(16, 22));
	});

	test("a schedule without a fact lists as it is saved, with its next start and no last result", async () => {
		const { list } = await project([nightly()], at(16, 12));
		expect((await list()).schedules).toEqual([
			{
				...nightly(),
				nextAt: at(16, 22),
				last: null,
				deliveries: [],
				issues: [],
			},
		]);
	});

	test("the next start is on the schedule's clock, not this computer's", async () => {
		// 22:00 in Tokyo on the 16th is 13:00 UTC.
		const { list } = await project(
			[nightly({ timeZone: "Asia/Tokyo" })],
			utc(2026, 9, 16, 12, 59),
		);
		expect((await list()).schedules[0]?.nextAt).toBe(utc(2026, 9, 16, 13));
	});

	test("lateMinutes do not make a time from before the schedule existed the next start", async () => {
		const { list } = await project(
			[nightly({ lateMinutes: 1440 })],
			at(16, 23),
		);
		const [listed] = (await list()).schedules;
		expect(listed?.last).toBeNull();
		expect(listed?.nextAt).toBe(at(17, 22));
	});

	test("a time skipped for an earlier run names that run", async () => {
		const { ports, list } = await project(
			[nightly({ cron: "0 * * * *" })],
			at(16, 23, 0, 30),
		);
		await ports.log.skipped({
			projectId: P,
			scheduleId: "nightly",
			at: at(16, 23),
			reason: "An earlier run of this schedule is still waiting.",
			runId: "run-1",
		});
		expect((await list()).schedules[0]?.last).toEqual({
			kind: "skipped",
			at: at(16, 23),
			reason: "An earlier run of this schedule is still waiting.",
			runId: "run-1",
		});
	});

	test("a schedule that is off has no next start", async () => {
		const { list } = await project([nightly({ enabled: false })]);
		expect((await list()).schedules[0]?.nextAt).toBeNull();
	});

	test("after Run now the last result is that run, and tonight's start is still next", async () => {
		const { ports, list } = await project([nightly()], at(16, 12));
		await ports.log.fired({
			projectId: P,
			scheduleId: "nightly",
			at: at(16, 12),
			runId: "run-1",
			error: null,
		});
		const [listed] = (await list()).schedules;
		expect(listed?.last).toMatchObject({ kind: "fired", runId: "run-1" });
		expect(listed?.nextAt).toBe(at(16, 22));
	});

	test("a pause tonight shows with the start after it, and a pause that has ended is dropped", async () => {
		const { ports, list } = await project(
			[nightly({ pausedUntil: at(17, 6) })],
			at(16, 12),
		);
		expect((await list()).schedules[0]).toMatchObject({
			pausedUntil: at(17, 6),
			nextAt: at(17, 22),
		});

		// After the morning the pause means nothing.
		ports.clock.set(at(17, 9));
		const [after] = (await list()).schedules;
		expect(after?.pausedUntil).toBeUndefined();
		expect(after?.nextAt).toBe(at(17, 22));
	});

	test("a webhook schedule has no times: it lists its latest deliveries, logged and refused, newest first", async () => {
		const hook: Schedule = {
			id: "review",
			flow: "night",
			inputs: {},
			webhook: { secret: HOOK_SECRET },
			enabled: true,
		};
		const { ports, refusals, list } = await project([hook, nightly()]);
		await ports.log.received({
			projectId: P,
			scheduleId: "review",
			at: 100,
			result: "filtered",
			runId: null,
			woke: 0,
			error: null,
		});
		await ports.log.received({
			projectId: P,
			scheduleId: "review",
			at: 200,
			result: "accepted",
			runId: "run-1",
			woke: 0,
			error: null,
		});
		refusals.add(P, "review", 300, "The schedule is paused.");
		refusals.add(P, "nightly", 400, "Not a webhook schedule.");

		const [listed, cron] = (await list()).schedules;
		expect(listed).toMatchObject({ id: "review", nextAt: null, last: null });
		expect(listed?.deliveries).toEqual([
			{
				at: 300,
				result: "refused",
				reason: "The schedule is paused.",
				runId: null,
				woke: 0,
			},
			{ at: 200, result: "accepted", reason: null, runId: "run-1", woke: 0 },
			{ at: 100, result: "filtered", reason: null, runId: null, woke: 0 },
		]);
		// A cron line lists none.
		expect(cron?.deliveries).toEqual([]);
	});

	test("an issue of the whole list is told apart from the issues of a schedule", async () => {
		const { ports, list } = await project([nightly()]);
		const read = ports.store.list;
		ports.store.list = async (projectId, options) => {
			const loaded = await read(projectId, options);
			return {
				...loaded,
				issues: [
					...loaded.issues,
					{ severity: "warning", message: "Update Night Shift to see them." },
				],
			};
		};
		const listed = await list();
		expect(listed.issues).toEqual([
			{ severity: "warning", message: "Update Night Shift to see them." },
		]);
		expect(listed.schedules[0]?.issues).toEqual([]);
	});

	test("a project of another Space, or none, is not found", async () => {
		const { ports, listIn } = await project([nightly()]);
		for (const asked of [listIn("space-2"), listIn(SPACE, "no-such-project")]) {
			const refused = await asked.then(
				() => null,
				(error: unknown) => error,
			);
			expect(refused).toBeInstanceOf(Refusal);
			expect(refused).toMatchObject({ kind: "not-found" });
		}
		// It is refused before anything is read.
		expect(await ports.facts()).toEqual([]);
	});

	test("every Member may, and nobody else", async () => {
		const { ports, listAs } = await project([nightly()]);
		expect(
			await ports.access.whoMay(SPACE, (actor) =>
				listAs(actor, { spaceId: SPACE, projectId: P }),
			),
		).toEqual(allowing("owner", "admin", "member", "viewer"));
	});
});
