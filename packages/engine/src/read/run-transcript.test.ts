import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	createRunBus,
	type Derive,
	foldRun,
	type LoggedEvent,
	type RunBus,
	type TranscriptEntry,
	waker,
} from "../log";
import type { FeedStep } from "./run-transcript";
import { followRunTranscript, type RunTranscriptPorts } from "./run-transcript";

/**
 * A run's transcript through its interface: the steps come from a fake
 * log, each step's entries from a fake source that a test writes into,
 * ends, or leaves hanging.
 */

const RUN = { id: "run-1", spaceId: "space-1" };

/** One step's source: the entries written so far, and whether it is whole. */
type Source = {
	entries: TranscriptEntry[];
	whole: boolean;
	wake: Set<() => void>;
	/** Each read of this step: from which seq, and its signal. */
	reads: { afterSeq: number; signal: AbortSignal }[];
	/** Reads that have not returned. */
	open: number;
};

let bus: RunBus;
let events: LoggedEvent[];
let sources: Map<string, Source>;
let eventSeq: number;
const controllers: AbortController[] = [];

beforeEach(() => {
	bus = createRunBus();
	events = [];
	sources = new Map();
	eventSeq = 0;
});
afterEach(() => {
	for (const c of controllers.splice(0)) c.abort();
});

function source(stepId: string): Source {
	let found = sources.get(stepId);
	if (!found) {
		found = { entries: [], whole: false, wake: new Set(), reads: [], open: 0 };
		sources.set(stepId, found);
	}
	return found;
}

/** The step's entries with these seqs. */
function write(stepId: string, ...seqs: number[]) {
	const s = source(stepId);
	for (const seq of seqs) {
		s.entries.push({
			seq,
			stepId,
			sessionId: null,
			at: 0,
			event: { type: "command-output", stream: "stdout", text: `${seq}` },
		} as TranscriptEntry);
	}
	for (const wake of [...s.wake]) wake();
}

/** The step's transcript is whole: a read returns after its last entry. */
function whole(stepId: string) {
	source(stepId).whole = true;
	for (const wake of [...source(stepId).wake]) wake();
}

function logged(type: string, stepId: string, payload: object) {
	eventSeq += 1;
	events.push({
		seq: eventSeq,
		runId: RUN.id,
		stepId,
		sessionId: null,
		type,
		payload,
		at: eventSeq,
	} as LoggedEvent);
}

/** A step starts: logged, then the bus says so. */
function start(stepId: string) {
	logged("StepStarted", stepId, {
		nodeId: stepId,
		nodeType: "command",
		visit: 1,
		transcriptPath: "",
		logPath: null,
	});
	bus.publish(RUN.id, { kind: "step-changed", stepId });
}

function end(stepId: string) {
	logged("StepEnded", stepId, { outcome: "pass", outputs: {}, error: null });
	bus.publish(RUN.id, { kind: "step-changed", stepId });
}

function reopen(stepId: string) {
	logged("StepReopened", stepId, {});
	bus.publish(RUN.id, { kind: "step-changed", stepId });
}

async function* stepEntries(
	step: FeedStep,
	afterSeq: number,
	signal: AbortSignal,
): AsyncGenerator<TranscriptEntry> {
	const s = source(step.stepId);
	s.reads.push({ afterSeq, signal });
	s.open++;
	const wakeUp = waker(signal);
	s.wake.add(wakeUp.notify);
	try {
		let index = 0;
		while (!signal.aborted) {
			const entry = s.entries[index];
			if (entry) {
				index++;
				if (entry.seq > afterSeq) yield entry;
				continue;
			}
			if (s.whole) return;
			await wakeUp.wait();
		}
	} finally {
		s.wake.delete(wakeUp.notify);
		wakeUp.close();
		s.open--;
	}
}

function ports(extra: Partial<RunTranscriptPorts> = {}): RunTranscriptPorts {
	return {
		log: {
			derive: async <T>(runIds: readonly string[], fn: Derive<T>) =>
				new Map(runIds.map((id) => [id, fn(foldRun([...events]))])),
		},
		bus,
		stepEntries,
		holdMs: 1_000,
		...extra,
	};
}

/** Reads the run's transcript in the background. */
function read(extra: Partial<RunTranscriptPorts> = {}, afterSeq = 0) {
	const controller = new AbortController();
	controllers.push(controller);
	const state = { got: [] as number[], error: null as unknown };
	const done = (async () => {
		try {
			for await (const entry of followRunTranscript(
				ports(extra),
				RUN,
				afterSeq,
				controller.signal,
			)) {
				state.got.push(entry.seq);
			}
		} catch (error) {
			state.error = error;
		}
	})();
	return { state, stop: () => controller.abort(), done };
}

async function until(check: () => boolean, ms = 2_000) {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("timed out");
		await Bun.sleep(2);
	}
}

const range = (from: number, to: number) =>
	Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** An ended step with these seqs. */
function endedStep(stepId: string, seqs: number[]) {
	start(stepId);
	write(stepId, ...seqs);
	end(stepId);
	whole(stepId);
}

describe("a run's transcript", () => {
	test("two steps one after the other go out in order, after the cursor", async () => {
		endedStep("a", [1, 2, 3]);
		endedStep("b", [4, 5]);
		const r = read({}, 2);
		await until(() => r.state.got.length === 3);
		expect(r.state.got).toEqual([3, 4, 5]);
	});

	test("a finished For Each: the Call step's entries and its body's, interleaved, in seq order", async () => {
		start("call");
		endedStep("item-1", range(11, 49));
		endedStep("item-2", range(52, 89));
		write("call", 10, 50, 51, 90);
		end("call");
		whole("call");
		const r = read();
		await until(() => r.state.got.length === 81);
		expect(r.state.got).toEqual(range(10, 90));
	});

	test("a live For Each: the body's entries go out while the Call step runs, and the Call step's next waits for them", async () => {
		start("call");
		write("call", 1);
		start("item-1");
		write("item-1", 2, 3);
		const r = read();
		await until(() => r.state.got.length === 3);
		expect(r.state.got).toEqual([1, 2, 3]);
		// The Call step's 5 comes before the body's 4.
		write("call", 5);
		await Bun.sleep(20);
		expect(r.state.got).toEqual([1, 2, 3]);
		write("item-1", 4);
		await until(() => r.state.got.length === 5);
		expect(r.state.got).toEqual([1, 2, 3, 4, 5]);
	});

	test("a gap nothing can fill, in a finished run, goes out at once", async () => {
		// A crash cut seq 3 short.
		endedStep("a", [1, 2]);
		endedStep("b", [4, 5]);
		const r = read({ holdMs: 60_000 });
		await until(() => r.state.got.length === 4, 500);
		expect(r.state.got).toEqual([1, 2, 4, 5]);
	});

	test("a gap in a running run goes out after the hold, and a late lower seq is dropped", async () => {
		start("a");
		start("b");
		write("a", 1);
		write("b", 3);
		const r = read({ holdMs: 30 });
		await until(() => r.state.got.length === 1);
		await Bun.sleep(10);
		expect(r.state.got).toEqual([1]);
		await until(() => r.state.got.length === 2);
		expect(r.state.got).toEqual([1, 3]);
		write("a", 2, 4);
		await until(() => r.state.got.length === 3);
		expect(r.state.got).toEqual([1, 3, 4]);
	});

	test("a step that starts later is followed from the run's cursor, and a reopened step again", async () => {
		endedStep("a", [1, 2]);
		const r = read();
		await until(() => r.state.got.length === 2);
		start("b");
		write("b", 3);
		await until(() => r.state.got.length === 3);
		expect(source("b").reads[0]?.afterSeq).toBe(2);
		write("b", 4);
		end("b");
		whole("b");
		await until(() => r.state.got.length === 4);

		// b reopens: read again, from the cursor.
		source("b").whole = false;
		reopen("b");
		await until(() => source("b").reads.length === 2);
		expect(source("b").reads[1]?.afterSeq).toBe(4);
		write("b", 5);
		await until(() => r.state.got.length === 5);
		expect(r.state.got).toEqual([1, 2, 3, 4, 5]);
	});

	test("ended steps are read a few at a time", async () => {
		let seq = 0;
		for (let i = 0; i < 10; i++) {
			start(`s${i}`);
			end(`s${i}`);
			seq += 1;
			write(`s${i}`, seq);
		}
		let most = 0;
		const r = read({ window: 2 });
		const watch = setInterval(() => {
			const reading = [...sources.values()].filter((s) => s.open > 0).length;
			most = Math.max(most, reading);
		}, 1);
		// Each step's read hangs until the test makes it whole.
		for (let i = 0; i < 10; i++) {
			await until(() => source(`s${i}`).reads.length === 1);
			await Bun.sleep(5);
			whole(`s${i}`);
		}
		await until(() => r.state.got.length === 10);
		clearInterval(watch);
		expect(most).toBe(2);
		expect(r.state.got).toEqual(range(1, 10));
	});

	test("an abort stops every step's read", async () => {
		start("a");
		start("b");
		write("a", 1);
		const r = read();
		await until(() => r.state.got.length === 1);
		await until(() => source("b").reads.length === 1);
		r.stop();
		await r.done;
		expect(source("a").reads[0]?.signal.aborted).toBe(true);
		expect(source("b").reads[0]?.signal.aborted).toBe(true);
		await until(() => source("a").open === 0 && source("b").open === 0);
	});

	test("an error of a step's read ends the read with it", async () => {
		endedStep("a", [1]);
		const r = read({
			stepEntries: () => {
				throw new Error("Run not found: run-1");
			},
		});
		await r.done;
		expect(String(r.state.error)).toContain("Run not found");
	});
});
