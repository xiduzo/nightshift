import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { StartRunInput } from "../../../contract";
import type { LoggedEvent, RunTrigger } from "../../../log";
import type { PlannedRun } from "../../../placement";
import {
	CAP_FULL,
	fakeDevice,
	HERE,
	inMemoryStartPorts,
	plannedOn,
} from "../adapters/out/in-memory-start-ports";
import { NO_BRANCHES } from "../domain/prepared-run";
import { START_TOO_LONG } from "../domain/start-deadline";
import { TEST_RUN_FROM_EDITOR } from "../domain/test-run";
import { startRunHere } from "./start-run-here";

/**
 * The start of a run this computer walks, on in-memory adapters: the
 * whole start is its Turn, and the run's row and its `RunStarted` are one
 * batch. The walk itself is the runner's (`graph`), and a whole engine
 * proves it (`test/engine/`).
 */

const SPACE = "space-1";
const MANUAL: RunTrigger = { kind: "manual" };

/** A Gate and an Agent: the Agent works in the worktree. */
const flow: Flow = {
	version: FLOW_VERSION,
	inputs: [{ name: "topic", type: "text" }],
	outputs: [],
	start: "research",
	nodes: [
		{
			id: "research",
			type: "agent",
			position: { x: 0, y: 0 },
			prompt: "Find leads",
			session: "fresh",
		},
		{
			id: "ship",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "Ship it?",
			options: [{ name: "yes" }, { name: "no" }],
			by: "person",
		},
	],
	edges: [],
} as Flow;

/** The start's ports with project `p1` in the Space, planned on this computer. */
function setUp(
	plan: (
		device: ReturnType<typeof fakeDevice>,
	) => Partial<Parameters<typeof plannedOn>[2]> = () => ({}),
	project: { folder?: boolean } = {},
) {
	const ports = inMemoryStartPorts();
	const device = fakeDevice();
	ports.projects.add({ id: "p1", spaceId: SPACE, ...project });
	ports.planner.planWith(async (input) =>
		plannedOn(device, flow, {
			// The plan names the start's Person, else this computer's owner.
			personId: input.start.startedBy ?? "person-owner",
			...plan(device),
		}),
	);
	const start = (input: Record<string, unknown> = {}, trigger = MANUAL) =>
		startRunHere(ports)({
			spaceId: SPACE,
			input: {
				projectId: "p1",
				flowName: "nightly",
				...input,
			} as StartRunInput,
			trigger,
		});
	return { ports, device, start };
}

/** The events of the run, by type, with their payloads. */
const typesOf = (events: readonly LoggedEvent[]) => events.map((e) => e.type);

describe("a start here", () => {
	test("writes the run's row and its RunStarted as one batch in its Turn, then the worktree", async () => {
		const { ports, device, start } = setUp();
		const run = await start({ inputs: { topic: "bikes" } });

		const [runId] = ports.turns.taken;
		expect(runId).toBeDefined();
		expect(run.id).toBe(runId as string);
		const row = ports.runs.rows.get(runId as string);
		expect(row).toMatchObject({
			spaceId: SPACE,
			projectId: "p1",
			flowName: "nightly",
			title: "nightly · topic bikes",
			worktreePath: `/worktrees/${(runId as string).slice(0, 8)}`,
			walkerId: HERE,
			deviceId: HERE,
			startedBy: "person-owner",
		});
		expect(typesOf(ports.runs.events(runId as string))).toEqual(["RunStarted"]);
		expect(ports.runs.events(runId as string)[0]?.payload).toMatchObject({
			projectId: "p1",
			flowName: "nightly",
			title: "nightly · topic bikes",
			start: "research",
			stopAt: null,
			inputs: { topic: "bikes" },
			trigger: MANUAL,
			startedBy: "person-owner",
		});
		// The rest of the start's facts follow the batch, in the run's own log.
		expect(typesOf(ports.facts.appended)).toEqual(["WorktreeCreated"]);
		expect(device.made).toEqual([{ id: runId as string, projectId: "p1" }]);
		// The Turn hands the walk the row, the inputs and the stop time.
		expect(ports.turns.prepared).toEqual([
			{ row, inputs: { topic: "bikes" }, stopAt: null, dueAt: "" },
		]);
		expect(ports.turns.settled).toBe(1);
	});

	test("a run started without a Person is the run of this computer's owner", async () => {
		const { ports, start } = setUp();
		const run = await start();
		const runId = run.id;
		expect(ports.runs.rows.get(runId)?.startedBy).toBe("person-owner");
		expect(ports.runs.events(runId)[0]?.payload).toMatchObject({
			startedBy: "person-owner",
		});
	});

	test("RunStarted names the Person who starts it, and the worktree commits in their name", async () => {
		const { ports, device, start } = setUp();
		const carol = { name: "Carol", email: "carol@example.com" };
		ports.starters.author("person-carol", carol);
		const run = await start({ startedBy: "person-carol" });
		expect(ports.runs.events(run.id)[0]?.payload).toMatchObject({
			startedBy: "person-carol",
		});
		expect(device.made[0]).toMatchObject({ author: carol });
		// A Person without a real email commits as the repository does.
		await start({ startedBy: "person-dan" });
		expect(device.made[1]).not.toHaveProperty("author");
	});

	test("a schedule's start keeps its trigger and when it was due", async () => {
		const { ports, start } = setUp();
		const trigger: RunTrigger = { kind: "schedule", scheduleId: "s", at: 500 };
		const run = await start({}, trigger);
		expect(ports.runs.events(run.id)[0]?.payload).toMatchObject({ trigger });
		expect(ports.turns.prepared[0]).toMatchObject({ dueAt: "due 500" });
		expect(ports.planner.planned[0]).toMatchObject({
			scheduled: true,
			byPerson: false,
		});
	});

	test("is refused after its deadline, and writes nothing after that", async () => {
		const ports = inMemoryStartPorts();
		ports.projects.add({ id: "p1", spaceId: SPACE });
		let release = () => {};
		// The Device never answers: the plan waits until the test ends it.
		ports.planner.planWith(
			() =>
				new Promise<PlannedRun>((_, reject) => {
					release = () => reject(new Error("released"));
				}),
		);
		const start = startRunHere({ ...ports, deadlineMs: 20 })({
			spaceId: SPACE,
			input: { projectId: "p1", flowName: "nightly" },
			trigger: MANUAL,
		});
		await expect(start).rejects.toThrow(START_TOO_LONG);
		// The runner frees the start's slot when its prepare settles.
		expect(ports.turns.settled).toBe(1);
		release();
		expect(ports.runs.rows.size).toBe(0);
	});

	test("a test run's start is refused for a schedule, a webhook and a quick run, and asks for no project", async () => {
		const { ports, start } = setUp();
		const marks = { skipped: { ship: "yes" } };
		for (const [input, trigger] of [
			[{ flowName: "watch" }, { kind: "schedule", scheduleId: "s", at: 1 }],
			[{ flowName: "watch" }, { kind: "webhook", scheduleId: "s", at: 1 }],
			[{ flowName: undefined, flow: { version: FLOW_VERSION } }, MANUAL],
		] as const) {
			await expect(
				start({ ...input, test: marks }, trigger as RunTrigger),
			).rejects.toThrow(TEST_RUN_FROM_EDITOR);
		}
		expect(ports.turns.taken).toEqual([]);
		expect(ports.planner.planned).toEqual([]);
	});

	test("a test run's pins come from this Walker's log, and RunStarted records the output each gives", async () => {
		const { ports, start } = setUp();
		const earlier = ports.runs;
		earlier.seed("run-earlier", {
			run: { projectId: "p1", spaceId: SPACE },
			state: {
				test: null,
				steps: new Map([
					[
						"step-1",
						{
							id: "step-1",
							nodeId: "research",
							nodeType: "agent",
							scope: null,
							endedAt: 10,
							outcome: "pass",
							outputs: { outcome: "pass", visit: 1 },
							test: null,
						},
					],
				]),
			} as never,
		});
		const run = await start({
			test: {
				pinned: { research: { runId: "run-earlier", stepId: "step-1" } },
			},
		});
		expect(ports.runs.events(run.id)[0]?.payload).toMatchObject({
			test: {
				pinned: {
					research: {
						runId: "run-earlier",
						stepId: "step-1",
						endedAt: 10,
						outcome: "pass",
					},
				},
				skipped: {},
			},
		});
	});

	test("refuses in the order a person reads: the pins, the base of a run folder, each Device, the stop time", async () => {
		const pinned = setUp();
		await expect(
			pinned.start({
				test: { pinned: { ghost: { runId: "run-gone", stepId: "x" } } },
			}),
		).rejects.toThrow(
			'Night Shift cannot find the output you pinned on "ghost".',
		);

		const folder = setUp(() => ({}), { folder: false });
		await expect(folder.start({ baseRef: "main" })).rejects.toThrow(
			NO_BRANCHES,
		);

		const unfit = setUp();
		unfit.ports.planner.unfit(HERE, "Add it under Agents.");
		await expect(unfit.start()).rejects.toThrow("Add it under Agents.");

		const noClone = setUp(() => ({ at: { hasClone: false } }));
		await expect(noClone.start()).rejects.toThrow(
			'The flow runs node "research" on This computer, but that device does not have this project. Add its folder there first.',
		);

		const late = setUp();
		late.ports.at(5_000);
		await expect(late.start({ stopAt: 5_000 })).rejects.toThrow(
			"The stop time has passed already.",
		);
		for (const { ports } of [pinned, folder, unfit, noClone, late]) {
			expect(ports.runs.rows.size).toBe(0);
		}
	});

	test("an offline Run's Device is not asked: the row keeps the asked base, with no branch, until it is back", async () => {
		const { ports, device, start } = setUp(() => ({ at: { offline: true } }));
		const run = await start({ baseRef: "release" });
		expect(ports.planner.fitted).toEqual([]);
		expect(device.made).toEqual([]);
		expect(ports.runs.rows.get(run.id)).toMatchObject({
			worktreePath: "",
			branch: "",
			baseRef: "release",
		});
		expect(ports.facts.appended).toEqual([]);
	});

	test("a project without a folder works in a run folder: no author, and RunStarted says so", async () => {
		const { ports, device, start } = setUp(() => ({}), { folder: false });
		ports.starters.author("person-owner", {
			name: "O",
			email: "o@example.com",
		});
		const run = await start();
		expect(device.made).toEqual([{ id: run.id, projectId: "p1" }]);
		expect(ports.runs.events(run.id)[0]?.payload).toMatchObject({
			runFolder: true,
		});
		expect(ports.runs.rows.get(run.id)?.worktreePath).toBe(
			`/run-folders/${run.id.slice(0, 8)}`,
		);
	});

	test("warns of a base the Device could not bring up to date, and of the Devices the plan passed over", async () => {
		const { ports, device, start } = setUp(() => ({
			notes: ["Laptop is offline, so the run runs here."],
		}));
		device.warn("The fetch failed. The run starts from main here.");
		const run = await start();
		expect(ports.facts.appended.map((e) => [e.type, e.payload])).toEqual([
			[
				"WorktreeCreated",
				{
					worktreePath: `/worktrees/${run.id.slice(0, 8)}`,
					branch: `nightshift/${run.id.slice(0, 8)}`,
					baseRef: "main",
				},
			],
			[
				"RunWarned",
				{
					kind: "base-ref",
					message: "The fetch failed. The run starts from main here.",
				},
			],
			[
				"RunWarned",
				{
					kind: "device-fallback",
					message: "Laptop is offline, so the run runs here.",
				},
			],
		]);
	});

	test("is refused while the Space's projects move, and takes no slot", async () => {
		const { ports, start } = setUp();
		const release = await ports.holds.hold(SPACE);
		await expect(start()).rejects.toThrow(
			"Night Shift moves the projects of this Space now. Try again in a minute.",
		);
		expect(ports.turns.taken).toEqual([]);
		release();
		await start();
		expect(ports.turns.taken).toHaveLength(1);
	});

	test("a full run cap refuses before anything is planned or written", async () => {
		const { ports, start } = setUp();
		ports.turns.fill();
		const refused = await start().catch((error: unknown) => error);
		expect(refused).toBeInstanceOf(Refusal);
		expect(refused).toMatchObject({ message: CAP_FULL });
		expect(ports.planner.planned).toEqual([]);
		expect(ports.runs.rows.size).toBe(0);
	});
});
