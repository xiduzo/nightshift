import { describe, expect, test } from "bun:test";
import type { Actor } from "../../../contract";
import { RunRefusal } from "../../../run-status";
import {
	ADA,
	FAR,
	inMemoryActionPorts,
	SPACE,
	stateOf,
} from "../adapters/out/in-memory-neighbours";
import { actOnRun } from "./act-on-run";
import { markRunUseful } from "./mark-run-useful";
import { recordTakeOver } from "./record-take-over";
import { releaseLease } from "./release-lease";
import { rerunFromNode } from "./rerun-from-node";
import { restartStep } from "./restart-step";
import { resumeRun } from "./resume-run";
import { sendSignal } from "./send-signal";
import { stopRun } from "./stop-run";

/**
 * An action at its seam, `actOnRun`: in the person's words, or as the
 * Command that carried it to this Walker. On a run another Device walks,
 * an action travels to its Walker as the Command of its kind, once the log
 * here allows it. On the Walker, the Command is applied as the action it
 * was. On in-memory adapters, with the answer and the move recorded as
 * their paths took them.
 */

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

function setup() {
	const ports = inMemoryActionPorts();
	/** What the answer and the move paths were handed. */
	const handed: { path: string; actor: Actor; request: unknown }[] = [];
	const act = actOnRun({
		stop: stopRun(ports),
		useful: markRunUseful(ports),
		signal: sendSignal(ports),
		releaseLease: releaseLease(ports),
		resume: resumeRun(ports),
		restart: restartStep(ports),
		rerun: rerunFromNode(ports),
		takeOver: recordTakeOver(ports),
		answer: async (actor, request) => {
			handed.push({ path: "answer", actor, request });
		},
		move: async (actor, request) => {
			handed.push({ path: "move", actor, request });
		},
	});
	return { ports, handed, act };
}

describe("an action on a run another Device walks", () => {
	test("travels to its Walker as the Command of its kind, in the person's name", async () => {
		const { ports, act } = setup();
		ports.put({ id: "run-1", walkerId: FAR });
		const on = { runId: "run-1", spaceId: SPACE };
		await act(ADA, { ...on, action: { kind: "stop" } });
		await act(ADA, { ...on, action: { kind: "useful", useful: true } });
		const to = {
			spaceId: SPACE,
			runId: "run-1",
			walkerId: FAR,
			personId: ADA.personId,
		};
		expect(ports.walkers.sent).toEqual([
			{ ...to, kind: "run.stop", payload: {} },
			{ ...to, kind: "run.useful", payload: { useful: true } },
		]);
	});

	test("is refused here, before it travels, when the log or the status rule says so", async () => {
		const { ports, act } = setup();
		ports.put({ id: "run-1", walkerId: FAR }, stateOf({ status: "waiting" }));
		const on = { runId: "run-1", spaceId: SPACE };
		// Only the Walker restarts, reruns or logs a take-over.
		for (const action of [
			{ kind: "restart" },
			{ kind: "rerun", nodeId: "build" },
			{ kind: "take-over" },
		] as const) {
			const refused = await refusalOf(act(ADA, { ...on, action }));
			expect(refused).toBeInstanceOf(RunRefusal);
			expect((refused as RunRefusal).rule).toBe("walked-elsewhere");
		}
		// The log here says the run waits at a Gate, not for a signal.
		const signal = await refusalOf(
			act(ADA, { ...on, action: { kind: "signal", name: "go" } }),
		);
		expect(signal).toBeInstanceOf(RunRefusal);
		expect(ports.walkers.sent).toEqual([]);
	});
});

describe("an answer and a move", () => {
	test("go to their paths, with the run, its Space and the person's words", async () => {
		const { act, handed } = setup();
		const on = { runId: "run-1", spaceId: SPACE };
		await act(ADA, {
			...on,
			action: {
				kind: "answer",
				stepId: "step-1",
				choice: "approve",
				via: "web",
			},
		});
		await act(ADA, { ...on, action: { kind: "move", to: "desk" } });
		expect(handed).toEqual([
			{
				path: "answer",
				actor: ADA,
				request: { ...on, stepId: "step-1", choice: "approve", via: "web" },
			},
			{ path: "move", actor: ADA, request: { ...on, to: "desk" } },
		]);
	});
});

describe("a Command that reached its Walker", () => {
	test("is applied as the person's action, as it came", async () => {
		const { ports, act, handed } = setup();
		ports.put({ id: "run-1" }, stateOf({ status: "running" }));
		const on = { runId: "run-1", spaceId: SPACE };
		const walker = { ...ADA, door: "command" as const };
		await act(walker, {
			...on,
			action: {
				kind: "gate.resolve",
				payload: { stepId: "step-1", choice: "approve" },
			},
		});
		await act(walker, {
			...on,
			action: { kind: "run.stop", payload: { when: "after-step" } },
		});
		expect(handed).toEqual([
			{
				path: "answer",
				actor: walker,
				request: { ...on, stepId: "step-1", choice: "approve" },
			},
		]);
		expect(ports.facts.appended.map((e) => e.type)).toEqual([
			"StopAfterStepRequested",
		]);
		expect(ports.walkers.sent).toEqual([]);
	});
});
