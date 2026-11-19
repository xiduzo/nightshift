import { describe, expect, test } from "bun:test";
import type { LoggedEvent } from "../../../log";
import {
	FAR,
	inMemoryMovePorts,
	stateOf,
} from "../adapters/out/in-memory-neighbours";
import { arriveRun } from "./arrive-run";

/**
 * The other end of a move, on in-memory adapters: this computer takes
 * over a run another Device moved here. What the new Walker then walks
 * is proven whole in `test/engine/move.test.ts`.
 */

/** This computer, as the Walker of its runs. */
const HERE = "this-computer";

/** A move of the run, as its old Walker logged it: by default the one that brought it here. */
const movedHere = (runId: string, from = FAR, to = HERE): LoggedEvent =>
	({
		seq: 7,
		runId,
		stepId: null,
		sessionId: null,
		type: "WalkerMoved",
		payload: { from, to, by: "person-ada" },
		at: 7,
	}) as LoggedEvent;

/** A run that moved here: its row, its log with the move, the archive with its walk state. */
async function setup() {
	const ports = inMemoryMovePorts();
	ports.put({ id: "run-1" }, stateOf({ status: "waiting" }));
	ports.facts.seed("run-1", [movedHere("run-1")]);
	await ports.handover.moved(movedHere("run-1"));
	ports.handover.archive.set("run-1", {
		checkpoint: "the checkpoint",
		transcripts: { s1: [1, 2], s2: [3, 5] },
	});
	return { ports, arrive: arriveRun(ports) };
}

describe("a run another Device moved here", () => {
	test("takes its Checkpoint and transcripts, logs WalkerArrived, then walks on from them", async () => {
		const { ports, arrive } = await setup();
		await arrive("run-1");
		expect(ports.held).toEqual([{ runId: "run-1", arrival: true }]);
		expect(ports.handover.walkState.get("run-1")).toEqual({
			checkpoint: "the checkpoint",
			transcripts: { s1: [1, 2], s2: [3, 5] },
		});
		expect(
			ports.facts.appended.map(({ type, payload }) => ({ type, payload })),
		).toEqual([{ type: "WalkerArrived", payload: { from: FAR } }]);
		// The next entry of its transcript comes after the old Walker's last.
		expect(ports.turns.continuedAfter.get("run-1")).toBe(5);
		expect(ports.turns.forgotten).toEqual(["run-1"]);
		expect(ports.turns.restored.map((r) => r.runId)).toEqual(["run-1"]);
		expect(ports.turns.restored[0]?.state.status).toBe(
			(await ports.facts.state("run-1")).status,
		);
	});

	test("a second take-over of the same Checkpoint changes nothing", async () => {
		const { ports, arrive } = await setup();
		await arrive("run-1");
		// Its log has WalkerArrived now: the hand-over sees it arrived.
		ports.handover.arrived("run-1");
		await arrive("run-1");
		expect(ports.facts.appended.map((e) => e.type)).toEqual(["WalkerArrived"]);
		expect(ports.turns.restored).toHaveLength(1);
	});

	test("cannot be taken over without its Checkpoint in the archive, and arrives once it is there", async () => {
		const { ports, arrive } = await setup();
		const kept = ports.handover.archive.get("run-1");
		ports.handover.archive.clear();
		await expect(arrive("run-1")).rejects.toThrow(
			"The archive has no checkpoint of the run.",
		);
		// Nothing says it arrived: the take-over is tried again.
		expect(ports.facts.appended).toEqual([]);
		expect(await ports.handover.arriving("run-1")).toBe(true);
		if (kept) ports.handover.archive.set("run-1", kept);
		await arrive("run-1");
		expect(ports.facts.appended.at(-1)).toMatchObject({
			type: "WalkerArrived",
			payload: { from: FAR },
		});
	});
});

test("a run that never moved, or moved elsewhere, is no arrival: nothing happens", async () => {
	const ports = inMemoryMovePorts();
	ports.put({ id: "run-1" });
	const arrive = arriveRun(ports);
	await arrive("run-1");
	ports.facts.seed("run-1", [movedHere("run-1", HERE, FAR)]);
	await arrive("run-1");
	expect(ports.facts.appended).toEqual([]);
	expect(ports.turns.restored).toEqual([]);
});
