import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "@langchain/langgraph";
import {
	failingScript,
	fakeHarness,
	reportingScript,
} from "@nightshift/agents/testing";
import { localDevice } from "../device/local";
import type { Device } from "../device/types";
import {
	agent,
	command,
	drive,
	flowOf,
	type Harness,
	payloads,
	startRun,
} from "../testing/graph";
import {
	createSandbox,
	type Sandbox,
	TEST_DEVICE_ID,
} from "../testing/test-support";

/**
 * A step that another Device takes over (ADR 17): the run warns about it,
 * and says which secrets work there, and the step stays where it moved to
 * when it goes on.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** What each Device was asked to run, with the run the call names. */
type Seen = { at: string; run: unknown }[];

/** The run's own computer as a Device that records what it runs. */
function recording(h: Harness, seen: Seen): Device {
	const device = localDevice({ id: TEST_DEVICE_ID, name: "here", ...h.local });
	return {
		...device,
		exec: (input) => {
			seen.push({ at: "here", run: input.run });
			return device.exec(input);
		},
		session: (input) => {
			seen.push({ at: "here", run: input.run });
			return device.session(input);
		},
	};
}

/** A Device that is away, then comes back when `away.online` turns true. */
function awayDevice(h: Harness, seen: Seen) {
	const away = { online: false };
	const device = localDevice({ id: "away", name: "away", ...h.local });
	return {
		away,
		device: {
			...device,
			state: async () => ({ online: away.online }),
			session: (input) => {
				seen.push({ at: "away", run: input.run });
				return device.session(input);
			},
		} as Device,
	};
}

const stepRunOf = (h: Harness) => ({
	spaceId: sandbox.spaceId,
	projectId: "project-1",
	runId: h.runId,
});

describe("a step another Device takes over", () => {
	test("while the run walks: it runs on the next Device, and the run warns", async () => {
		const h = await startRun(sandbox, flowOf([command("work", "true")]));
		const seen: Seen = [];
		const { device } = awayDevice(h, seen);
		h.ctx.deviceFor = () => device;
		h.ctx.fallbacksFor = async () => [recording(h, seen)];

		const done = await drive(h, { inputs: {} });

		expect(done.state.ended?.status).toBe("finished");
		expect(seen).toEqual([{ at: "here", run: stepRunOf(h) }]);
		const logged = await h.events();
		expect(payloads(logged, "StepMoved")).toEqual([
			{ from: "away", to: TEST_DEVICE_ID },
		]);
		expect(payloads(logged, "RunWarned")).toEqual([
			{
				kind: "device-fallback",
				message:
					"away is offline. here takes over this step. Space and project secrets work there. Secrets saved only on another computer do not.",
			},
		]);
	});

	test("to the Host: the warning says Personal secrets do not work there", async () => {
		const h = await startRun(sandbox, flowOf([command("work", "true")]));
		h.ctx.run = {
			...h.ctx.run,
			fallbacks: JSON.stringify({
				run: [],
				nodes: {},
				hostId: TEST_DEVICE_ID,
			}),
		};
		const { device } = awayDevice(h, []);
		h.ctx.deviceFor = () => device;
		h.ctx.fallbacksFor = async () => [recording(h, [])];

		await drive(h, { inputs: {} });

		expect(payloads(await h.events(), "RunWarned")[0]?.message).toBe(
			"away is offline. here takes over this step. Space and project secrets work there. Personal secrets and secrets saved on another computer do not.",
		);
	});

	test("that goes on later: it stays where it moved to, also when its first Device is back", async () => {
		const harness = fakeHarness((_input, call: number) =>
			call === 0 ? failingScript("boom") : reportingScript("pass", "Fixed"),
		);
		const h = await startRun(sandbox, flowOf([agent("worker", "Work.")]), {
			harness,
		});
		const seen: Seen = [];
		const { away, device } = awayDevice(h, seen);
		h.ctx.deviceFor = () => device;
		h.ctx.fallbacksFor = async () => [recording(h, seen)];

		const first = await drive(h, { inputs: {} });
		const [parked] = first.parked;
		expect(parked).toBeDefined();
		away.online = true;

		const second = await drive(
			h,
			new Command({ resume: { kind: "resume", prompt: "Try again" } }),
		);

		expect(second.state.ended?.status).toBe("finished");
		expect(harness.calls[1]?.resumeSessionId).toBe("fake-session-1");
		expect(seen.map((s) => s.at)).toEqual(["here", "here"]);
		expect(payloads(await h.events(), "StepMoved")).toHaveLength(1);
	});
});
