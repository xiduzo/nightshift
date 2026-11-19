import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow } from "@nightshift/flows";
import { type Actor, NIGHT_SHIFT, type StartRunInput } from "../../../contract";
import type { RunTrigger } from "../../../log";
import type { RunSummary } from "../../../read";
import {
	fakeDevice,
	HERE,
	inMemoryStartPorts,
	plannedOn,
} from "../adapters/out/in-memory-start-ports";
import { TEST_RUN_FROM_EDITOR } from "../domain/test-run";
import { startRun } from "./start-run";
import { startRunHere } from "./start-run-here";
import { startRunOnHost } from "./start-run-on-host";

/**
 * A start by a person, or by Night Shift in this process, on in-memory
 * adapters: who may start runs in the Space, and who walks the run (ADR 1,
 * decisions 9 and 10). `space-own` is kept here, `space-host` by a Host
 * (`host-h`).
 */

const ADA: Actor = { personId: "person-ada" };

/** What access says of a Space the Person is not a Member of. */
const NO_SPACE = { kind: "not-found", message: "That Space does not exist." };
const SUMMARY = { id: "run-1" } as unknown as RunSummary;

/** The start with fakes for its two halves: each records where the start went. */
function places(options: { reachable?: boolean } = {}) {
	const ports = inMemoryStartPorts();
	ports.access.members.join("space-own", "person-ada", "member");
	ports.access.members.join("space-host", "person-ada", "member");
	ports.projects.add({ id: "project-1", spaceId: "space-own" });
	ports.projects.add({ id: "project-hosted", spaceId: "space-host" });
	ports.keeper.hostedBy("space-host", "host-h");
	ports.keeper.link("space-host", options.reachable ?? true);
	/** Each start, where it went and what it carried. */
	const started: {
		where: "host" | "here";
		spaceId: string;
		input: StartRunInput;
		trigger?: RunTrigger;
	}[] = [];
	const start = startRun({
		...ports,
		here: async ({ spaceId, input, trigger }) => {
			started.push({ where: "here", spaceId, input, trigger });
			return SUMMARY;
		},
		onHost: async ({ spaceId, input }) => {
			started.push({ where: "host", spaceId, input });
			return SUMMARY;
		},
	});
	return { ports, started, start };
}

const MANUAL: RunTrigger = { kind: "manual" };

describe("a person's start", () => {
	test("goes to the Host that keeps the Space, with where the person started", async () => {
		const p = places();
		const input = {
			projectId: "project-hosted",
			flowName: "flow",
			deviceId: "laptop",
		};
		expect(await p.start(ADA, { ...input, spaceId: "space-host" })).toBe(
			SUMMARY,
		);
		expect(p.started).toEqual([
			{
				where: "host",
				spaceId: "space-host",
				input: { ...input, startedBy: "person-ada", startedFrom: HERE },
			},
		]);
	});

	test("starts here in a Space this Replica keeps, with the pick as the Run's Device", async () => {
		const p = places();
		const input = { projectId: "project-1", flowName: "flow" };
		await p.start(ADA, { ...input, spaceId: "space-own" });
		await p.start(ADA, { ...input, deviceId: "desktop", spaceId: "space-own" });
		expect(p.started).toEqual([
			{
				where: "here",
				spaceId: "space-own",
				input: { ...input, startedBy: "person-ada" },
				trigger: MANUAL,
			},
			{
				where: "here",
				spaceId: "space-own",
				input: { ...input, deviceId: "desktop", startedBy: "person-ada" },
				trigger: MANUAL,
			},
		]);
	});

	test("a Device that cannot reach its Host walks the run itself (decision 10)", async () => {
		const p = places({ reachable: false });
		await p.start(ADA, {
			projectId: "project-hosted",
			flowName: "flow",
			spaceId: "space-host",
		});
		expect(p.started.map((s) => s.where)).toEqual(["here"]);
	});

	test("a Person's start is theirs: Night Shift's keeps the Person it names", async () => {
		const p = places();
		await p.start(ADA, {
			projectId: "project-1",
			flowName: "flow",
			startedBy: "person-carol",
			spaceId: "space-own",
		});
		await p.start(NIGHT_SHIFT, {
			projectId: "project-1",
			flowName: "flow",
			startedBy: "person-carol",
			spaceId: "space-own",
		});
		await p.start(NIGHT_SHIFT, {
			projectId: "project-1",
			flowName: "flow",
			spaceId: "space-own",
		});
		expect(p.started.map((s) => s.input.startedBy)).toEqual([
			"person-ada",
			"person-carol",
			undefined,
		]);
	});
});

describe("who may start a run", () => {
	test("a Person whose role may not start runs is refused before the project is read", async () => {
		const p = places();
		p.ports.access.members.join("space-own", "person-vic", "viewer");
		const refused = p.start(
			{ personId: "person-vic" },
			{ projectId: "gone", flowName: "flow", spaceId: "space-own" },
		);
		await expect(refused).rejects.toBeInstanceOf(p.ports.access.RoleRefusal);
		expect(p.started).toEqual([]);
	});

	test("a Person who is not a Member of the Space finds no Space", async () => {
		const p = places();
		await expect(
			p.start(
				{ personId: "person-eve" },
				{ projectId: "project-1", flowName: "flow", spaceId: "space-own" },
			),
		).rejects.toMatchObject(NO_SPACE);
		expect(p.started).toEqual([]);
	});

	test("Night Shift itself may start a run in any Space", async () => {
		const p = places();
		await p.start(NIGHT_SHIFT, {
			projectId: "project-1",
			flowName: "flow",
			spaceId: "space-own",
		});
		expect(p.started).toHaveLength(1);
	});

	test("a project of another Space is not found", async () => {
		const p = places();
		await expect(
			p.start(ADA, {
				projectId: "project-hosted",
				flowName: "flow",
				spaceId: "space-own",
			}),
		).rejects.toMatchObject({ kind: "not-found" });
		expect(p.started).toEqual([]);
	});
});

describe("a test run's start (ADR 27)", () => {
	const marks = { skipped: { approve: "send" } };

	test("goes to the Host with its pins and skips, as a person starts it", async () => {
		const p = places();
		const input = {
			projectId: "project-hosted",
			flowName: "flow",
			test: marks,
		};
		await p.start(ADA, { ...input, spaceId: "space-host" });
		expect(p.started).toEqual([
			{
				where: "host",
				spaceId: "space-host",
				input: { ...input, startedBy: "person-ada", startedFrom: HERE },
			},
		]);
	});

	test("of a quick run is refused before it goes anywhere: the Host's start knows no flow name", async () => {
		const p = places();
		for (const spaceId of ["space-host", "space-own"]) {
			await expect(
				p.start(ADA, {
					projectId: spaceId === "space-host" ? "project-hosted" : "project-1",
					flow: { version: FLOW_VERSION } as Flow,
					// A quick run takes no pins: only a request can carry them.
					test: marks,
					spaceId,
				} as unknown as StartRunInput & { spaceId: string }),
			).rejects.toThrow(TEST_RUN_FROM_EDITOR);
		}
		expect(p.started).toEqual([]);
	});
});

describe("a start, whole", () => {
	test("here: the run's row and RunStarted name the Person who starts it", async () => {
		const ports = inMemoryStartPorts();
		ports.access.members.join("space-own", "person-ada", "member");
		ports.projects.add({ id: "project-1", spaceId: "space-own" });
		const device = fakeDevice();
		const flow = {
			version: FLOW_VERSION,
			inputs: [],
			outputs: [],
			start: "ship",
			nodes: [
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
		} as unknown as Flow;
		ports.planner.planWith(async (input) =>
			plannedOn(device, flow, { personId: input.start.startedBy ?? null }),
		);
		const start = startRun({
			...ports,
			here: startRunHere(ports),
			onHost: startRunOnHost(ports),
		});
		const run = await start(ADA, {
			projectId: "project-1",
			flowName: "nightly",
			spaceId: "space-own",
		});
		expect(ports.runs.rows.get(run.id)?.startedBy).toBe("person-ada");
		expect(ports.runs.events(run.id)[0]?.payload).toMatchObject({
			startedBy: "person-ada",
			trigger: MANUAL,
		});
	});
});
