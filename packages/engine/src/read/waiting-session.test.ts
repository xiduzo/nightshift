import { describe, expect, test } from "bun:test";

import type { EnginePayloads, StepOutcome } from "../log";
import { runEvents } from "../testing/run-events";
import { OUTRUN_ERROR, waitingSession, wakesNext } from "./waiting-session";

type Log = ReturnType<typeof runEvents>;

/** An Agent step whose harness named its session, unless `named` is false. */
const agentStep = (
	log: Log,
	id: string,
	{
		named = true,
		...more
	}: Partial<EnginePayloads["StepStarted"]> & { named?: boolean } = {},
) => {
	log.stepStarted(id, id, 1, { nodeType: "agent", ...more });
	log.sessionStarted(id, `${id}-s`);
	return named
		? log.push(
				"HarnessSessionAssigned",
				{ harnessSessionId: `h-${id}`, model: null },
				{ stepId: id, sessionId: `${id}-s` },
			)
		: log;
};
const edge = (log: Log, from: string, to: string) =>
	log.push("EdgeTaken", {
		edgeId: `${from}-${to}`,
		from,
		to,
		outcome: "fail",
		scope: null,
	});
const ended = (
	log: Log,
	status: "stopped" | "failed" | "finished",
	reason: string | null = null,
) => log.push("RunEnded", { status, reason });
const cut = (log: Log, id: string, outcome: StepOutcome = "stopped") =>
	log.stepEnded(id, outcome);
const waits = (log: Log) => waitingSession(log.state())?.id ?? null;
const start = () => runEvents().runStarted();

describe("the session that gets the prompt of a resume", () => {
	test("none while the run goes on", () => {
		expect(waits(agentStep(start(), "a"))).toBeNull();
	});

	test("of two branches that wait, the step that started last", () => {
		const log = agentStep(agentStep(start(), "a"), "b");
		expect(waits(ended(cut(cut(log, "a"), "b"), "stopped"))).toBe("b");
	});

	test("not an Agent whose failure took an edge: no session waits", () => {
		const log = agentStep(start(), "a");
		log.stepStarted("slow", "slow", 1, { nodeType: "command" });
		edge(log.stepEnded("a", "fail"), "a", "joined");
		expect(waits(ended(cut(log, "slow"), "stopped"))).toBeNull();
	});

	test("not a step whose session got no name, though it started last", () => {
		const log = agentStep(agentStep(start(), "a"), "b", { named: false });
		expect(waits(ended(cut(cut(log, "a"), "b"), "stopped"))).toBe("a");
	});

	test("not a branch that another one outran", () => {
		const log = agentStep(agentStep(start(), "a"), "b");
		log.push(
			"StepEnded",
			{ outcome: "stopped", outputs: {}, error: OUTRUN_ERROR },
			{ stepId: "b" },
		);
		expect(waits(ended(cut(log, "a"), "stopped"))).toBe("a");
	});

	test("its own end: only when the run failed on it", () => {
		const failed = (reason: string | null) => {
			const log = agentStep(start(), "a").stepEnded("a", "fail");
			return waits(ended(log, reason ? "failed" : "stopped", reason));
		};
		expect(failed('Node "a" ended with "fail" and no edge leaves it.')).toBe(
			"a",
		);
		expect(failed("The engine failed.")).toBeNull();
		expect(failed(null)).toBeNull();
	});

	test("its own end, and a stop before the resume opened it again: still parked", () => {
		const log = agentStep(start(), "a").stepEnded("a", "fail");
		ended(log, "failed", 'Node "a" ended with "fail" and no edge leaves it.');
		log.resumed("a", "a", { prompt: "First." });
		expect(waits(ended(log, "stopped"))).toBe("a");
	});

	test("an earlier session that a failed step went on from, though its own got no name", () => {
		const log = start().stepStarted("a", "a", 1, { nodeType: "agent" });
		log.sessionStarted("a", "x", { resumeSessionId: "h" });
		log.stepEnded("a", "error");
		expect(waits(ended(log, "failed", 'Node "a" failed: boom'))).toBe("a");
		expect(waits(log)).toBe("a");
	});

	test("a later visit of the node is the one that counts", () => {
		const log = cut(agentStep(start(), "a"), "a", "error");
		log.stepStarted("a2", "a", 2, { nodeType: "agent" });
		log.sessionStarted("a2", "x");
		expect(waits(ended(cut(log, "a2"), "stopped"))).toBeNull();
	});

	test("a step that opened again after its edge: a loop's later session waits", () => {
		const log = edge(agentStep(start(), "a").stepEnded("a", "fail"), "a", "b");
		log.stepStarted("a2", "a", 2, { nodeType: "agent" });
		log.sessionStarted("a2", "x");
		log.push(
			"HarnessSessionAssigned",
			{ harnessSessionId: "h2", model: null },
			{ stepId: "a2", sessionId: "x" },
		);
		expect(waits(ended(cut(log, "a2"), "stopped"))).toBe("a2");
	});

	test("an own end after an earlier failure of the run is not that failure's", () => {
		const log = agentStep(start(), "a").stepEnded("a", "fail");
		ended(log, "failed", 'Node "a" ended with "fail" and no edge leaves it.');
		log.resumed("a", "a").stepReopened("a").stepEnded("a", "pass");
		expect(waits(ended(log, "stopped"))).toBeNull();
	});

	test("an earlier session, and a stop: nothing to continue", () => {
		const log = start().stepStarted("a", "a", 1, { nodeType: "agent" });
		log.sessionStarted("a", "x", { resumeSessionId: "h" });
		expect(waits(ended(cut(log, "a"), "stopped"))).toBeNull();
	});

	test("a called flow that the stop time ended, and the walk went on from", () => {
		const scope = { parentStepId: "sub", itemId: null };
		const log = start().stepStarted("sub", "sub", 1, { nodeType: "call" });
		cut(cut(agentStep(log, "in", { scope }), "in"), "sub");
		expect(waits(ended(edge(log, "sub", "wrap"), "stopped"))).toBeNull();
	});

	test("a finished run: its last step, when it is an Agent", () => {
		const one = () => agentStep(start(), "a").stepEnded("a", "pass");
		expect(waits(ended(one(), "finished"))).toBe("a");
		const two = edge(one(), "a", "b");
		two.stepStarted("b", "b", 1, { nodeType: "command" }).stepEnded("b");
		expect(waits(ended(two, "finished"))).toBeNull();
	});

	test("not a step before a run again", () => {
		const log = ended(cut(agentStep(start(), "a"), "a"), "stopped");
		log.resumed("first", null, { action: "rerun" });
		expect(waits(ended(log, "stopped"))).toBeNull();
	});

	test("inside a called flow: only while its Call is the one that goes on", () => {
		const scope = { parentStepId: "sub", itemId: null };
		const log = () =>
			cut(
				agentStep(
					start().stepStarted("sub", "sub", 1, { nodeType: "call" }),
					"in",
					{
						scope,
					},
				),
				"in",
			);
		expect(waits(ended(cut(log(), "sub"), "stopped"))).toBe("in");
		expect(waits(ended(log().stepEnded("sub", "fail"), "stopped"))).toBeNull();
	});

	test("not an element that ended, though the loop goes on", () => {
		const scope = { parentStepId: "sub", itemId: "x" };
		const log = start().stepStarted("sub", "sub", 1, { nodeType: "call" });
		log.push(
			"ItemStarted",
			{
				item: { id: "x", title: "x" } as never,
				index: 1,
				branch: null,
				baseBranch: null,
				inputs: {},
			},
			{ stepId: "sub" },
		);
		cut(agentStep(log, "in", { scope }), "in", "error");
		const open = waits(ended(cut(copy(log), "sub"), "stopped"));
		expect(open).toBe("in");
		log.push(
			"ItemEnded",
			{ itemId: "x", state: "failed", reason: null, outputs: {} },
			{ stepId: "sub" },
		);
		expect(waits(ended(cut(log, "sub"), "stopped"))).toBeNull();
	});
});

describe("the wait that a wake ends", () => {
	const log = start().stepStarted("a", "a").waitStarted("a", { until: 800 });
	log.stepStarted("b", "b").waitStarted("b", { until: 400 });
	log.stepStarted("c", "c").waitStarted("c", { until: null, signal: "go" });
	const next = (signal?: string) =>
		wakesNext(log.state(), signal)?.stepId ?? null;

	test("the earliest, or the one for the signal, and not one that woke", () => {
		expect(next()).toBe("b");
		expect(next("go")).toBe("c");
		expect(next("other")).toBe("b");
		log.waitEnded("b");
		expect(next()).toBe("a");
		log.waitEnded("a").waitEnded("c");
		expect(next()).toBeNull();
	});

	test("not one whose step ended or opened again, nor one of an earlier walk", () => {
		const asleep = () =>
			start().stepStarted("a", "a").waitStarted("a", { until: 800 });
		const next = (log: Log) => wakesNext(log.state())?.stepId ?? null;
		expect(next(asleep())).toBe("a");
		expect(next(asleep().stepEnded("a", "stopped"))).toBeNull();
		expect(next(asleep().stepReopened("a"))).toBeNull();
		expect(next(ended(asleep(), "stopped"))).toBeNull();
		expect(next(asleep().resumed("a"))).toBeNull();
	});
});

/** A log with the events of `log` so far. */
function copy(log: Log): Log {
	const next = runEvents();
	for (const e of log.events) {
		next.push(
			e.type,
			e.payload as never,
			{
				stepId: e.stepId ?? undefined,
				sessionId: e.sessionId ?? undefined,
			} as never,
		);
	}
	return next;
}
