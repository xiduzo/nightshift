import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import type { CommandNode, DecisionNode, Flow } from "@nightshift/flows";
import type { Relay } from "../contract";
import { createRunLog } from "../log/run-log";
import { RunRefusal } from "../run-status";
import { alonePeers } from "../testing/alone-peers";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { createEngine } from "./engine";
import type { PeersFactory } from "./peers";

/**
 * The Command at its seam, `SpaceEngine.act`: on a run another Device
 * walks, an action travels to its Walker as the Command of its kind,
 * through the Relay, once the log here allows it. On the Walker, `act`
 * takes the Command as it came and applies it as the person's action.
 */

const build: CommandNode = {
	id: "build",
	type: "command",
	position: { x: 0, y: 0 },
	command: "echo built",
	output: "text",
};

const gate: DecisionNode = {
	id: "gate",
	type: "decision",
	position: { x: 0, y: 0 },
	prompt: "Ship it?",
	options: [{ name: "approve" }, { name: "reject" }],
	by: "person",
	decider: "typesafe",
};

/** build → gate. The answer ends the run. */
const gateFlow: Flow = {
	version: 8,
	inputs: [],
	outputs: [],
	start: "build",
	nodes: [build, gate],
	edges: [{ id: "e1", from: "build", outcome: "pass", to: "gate" }],
};

const actor = { personId: "the-person" };
/** Another of the Person's Devices, online: a run can move to it. */
const laptop = { id: "laptop", name: "Laptop" };

let sandbox: Sandbox;
/** What this computer handed to the Hosts it links to. */
let sent: Parameters<Relay["command"]>[0][];
beforeEach(async () => {
	sandbox = await createSandbox();
	sent = [];
});
afterEach(() => sandbox.cleanup());

/** The engine of a computer alone, whose Relay records the Commands it sends. */
function makeSpace() {
	const relay: Relay = {
		async command(command) {
			sent.push(command);
		},
		addProject: () => Promise.reject(new Error("Not in this test.")),
		addClone: () => Promise.reject(new Error("Not in this test.")),
		reachable: async () => false,
		startRun: () => Promise.reject(new Error("Not in this test.")),
	};
	const peers: PeersFactory = (context) => {
		const alone = alonePeers(context);
		return {
			...alone,
			relay,
			placement: {
				...alone.placement,
				moveTo: async (_row, _actor, to) => (to === laptop.id ? laptop : null),
			},
			runs: { ...alone.runs, async keepWalk() {} },
		};
	};
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness(() => ({})) },
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
			peers,
		}),
		{
			runLog: createRunLog(sandbox.db, {
				walkerId: sandbox.deviceId,
				dataDir: sandbox.dataDir,
			}),
		},
	).space(sandbox.spaceId, actor);
}

/** A run of the gate flow, waiting at its Gate. */
async function waitingRun() {
	const space = makeSpace();
	const { id: projectId } = await space.addProject({
		repoPath: sandbox.repoPath,
	});
	const run = await space.startRun({ projectId, flow: gateFlow });
	await waitFor(async () => (await space.getRun(run.id)).status === "waiting", {
		label: "the run to wait at the Gate",
	});
	const open = (await space.getRun(run.id)).steps.at(-1)?.id ?? "";
	return { space, runId: run.id, open };
}

describe("an action on a run another Device walks", () => {
	test("travels to its Walker as the Command of its kind, in the person's name", async () => {
		const { space, runId, open } = await waitingRun();
		await space.act(runId, { kind: "move", to: laptop.id });
		expect((await space.getRun(runId)).walker.thisDevice).toBe(false);

		await space.act(runId, {
			kind: "answer",
			stepId: open,
			choice: "approve",
			via: "web",
		});
		await space.act(runId, { kind: "stop" });
		await space.act(runId, { kind: "useful", useful: true });
		await space.act(runId, { kind: "move", to: "desk" });

		const to = {
			spaceId: sandbox.spaceId,
			runId,
			walkerId: laptop.id,
			personId: actor.personId,
		};
		expect(sent).toEqual([
			{
				...to,
				kind: "gate.resolve",
				payload: { stepId: open, choice: "approve", via: "web" },
			},
			{ ...to, kind: "run.stop", payload: {} },
			{ ...to, kind: "run.useful", payload: { useful: true } },
			{ ...to, kind: "run.move", payload: { to: "desk" } },
		]);
	});

	test("is refused here, before it travels, when the log or the status rule says so", async () => {
		const { space, runId } = await waitingRun();
		await space.act(runId, { kind: "move", to: laptop.id });

		// Only the Walker restarts or reruns.
		for (const action of [
			{ kind: "restart" },
			{ kind: "rerun", nodeId: "build" },
		] as const) {
			const refusal = await space.act(runId, action).catch((e) => e);
			expect(refusal).toBeInstanceOf(RunRefusal);
			expect((refusal as RunRefusal).rule).toBe("walked-elsewhere");
		}
		// The log here says the run waits at a Gate, not for a signal.
		const signal = await space
			.act(runId, { kind: "signal", name: "go" })
			.catch((e) => e);
		expect(signal).toBeInstanceOf(RunRefusal);
		expect(sent).toEqual([]);
	});
});

describe("a Command that reached its Walker", () => {
	test("is applied as the person's action, as it came", async () => {
		const { space, runId, open } = await waitingRun();
		await space.act(runId, {
			kind: "gate.resolve",
			payload: { stepId: open, choice: "approve" },
		});
		await waitFor(
			async () => (await space.getRun(runId)).status === "finished",
			{ label: "the run to end" },
		);
		expect(
			(await space.getRun(runId)).steps.map((s) => [s.nodeId, s.outcome]),
		).toEqual([
			["build", "pass"],
			["gate", "approve"],
		]);
		expect(sent).toEqual([]);
	});
});
