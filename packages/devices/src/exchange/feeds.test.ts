import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { TranscriptEntry } from "@nightshift/engine";
import { createRunBus, type RunBus } from "@nightshift/engine/testing";
import {
	createTranscriptFeeds,
	type FollowPumps,
	type TranscriptFeeds,
} from "./feeds";

/**
 * Live transcripts through the feed's interface, three Replicas in one
 * process: W walks the run, H is the Host that keeps its Space, V views
 * it through H. The link is a fake: W's pumps push straight into H, and
 * H's demand reaches W's pumps the way the sync stream carries it.
 */

const SPACE = "space-1";
const RUN = "run-1";
const STEP: { spaceId: string; runId: string; stepId: string } = {
	spaceId: SPACE,
	runId: RUN,
	stepId: "step-1",
};

let wBus: RunBus;
/** W's transcript files, by step. */
let files: Map<string, TranscriptEntry[]>;
/** Steps that ended on W. */
let endedOnW: Set<string>;
/** Steps whose end reached H's log, and H's archive copies. */
let endedOnH: Set<string>;
let archiveOnH: Map<string, TranscriptEntry[]>;
/** Every push W made to H. */
let pushes: { stepId: string; seqs: number[]; ended: boolean }[];
let seq: number;

let w: TranscriptFeeds;
let h: TranscriptFeeds;
let v: TranscriptFeeds;
let pumps: FollowPumps;
let stopDemand: () => void;
const controllers: AbortController[] = [];

const owner = async (runId: string) =>
	runId === RUN ? { walkerId: "w", spaceId: SPACE } : null;

beforeEach(() => {
	wBus = createRunBus();
	files = new Map();
	endedOnW = new Set();
	endedOnH = new Set();
	archiveOnH = new Map();
	pushes = [];
	seq = 0;
	w = createTranscriptFeeds({
		watch: wBus.subscribe,
		selfId: async () => "w",
		runOwner: owner,
		hostOf: async () => "h",
		stepEnded: async (s) => endedOnW.has(s.stepId),
		ownEntries: async (s) => [...(files.get(s.stepId) ?? [])],
		archived: async () => null,
		retryMs: 5,
	});
	h = createTranscriptFeeds({
		watch: createRunBus().subscribe,
		selfId: async () => "h",
		runOwner: owner,
		hostOf: async () => null,
		stepEnded: async (s) => endedOnH.has(s.stepId),
		ownEntries: async () => [],
		archived: async (s) => archiveOnH.get(s.stepId) ?? null,
	});
	v = createTranscriptFeeds({
		watch: createRunBus().subscribe,
		selfId: async () => "v",
		runOwner: owner,
		hostOf: async () => "h",
		stepEnded: async () => false,
		ownEntries: async () => [],
		archived: async () => null,
		upstream: (step, afterSeq, signal) => h.follow(step, afterSeq, signal),
	});
	// The link: W pushes into H; H's demand rides to W as on the sync stream.
	pumps = w.pumps(async (step, entries, ended) => {
		pushes.push({
			stepId: step.stepId,
			seqs: entries.map((e) => e.seq),
			ended,
		});
		h.deliver("w", step, entries, ended);
	});
	stopDemand = h.onWanted("w", () =>
		queueMicrotask(() => pumps.set(h.wanted("w"))),
	);
});

afterEach(() => {
	for (const c of controllers.splice(0)) c.abort();
	stopDemand();
	pumps.close();
});

/** W's step writes an entry: on disk first, then on the bus. */
function write(stepId = STEP.stepId): TranscriptEntry {
	seq += 1;
	const entry: TranscriptEntry = {
		seq,
		stepId,
		sessionId: null,
		at: Date.now(),
		event: { type: "command-output", stream: "stdout", text: `line ${seq}\n` },
	} as TranscriptEntry;
	files.set(stepId, [...(files.get(stepId) ?? []), entry]);
	wBus.publish(RUN, { kind: "transcript", entry });
	return entry;
}

/** W's step ends: logged, then the bus says so. */
function end(stepId = STEP.stepId) {
	endedOnW.add(stepId);
	wBus.publish(RUN, { kind: "step-changed", stepId });
}

/** Follows a feed in the background: what it got, and whether it ended. */
function follow(feeds: TranscriptFeeds, afterSeq = 0, step = STEP) {
	const controller = new AbortController();
	controllers.push(controller);
	const got: number[] = [];
	const state = { got, ended: false, error: null as unknown };
	const done = (async () => {
		try {
			for await (const entry of feeds.follow(
				step,
				afterSeq,
				controller.signal,
			)) {
				got.push(entry.seq);
			}
			state.ended = !controller.signal.aborted;
		} catch (error) {
			state.error = error;
		}
	})();
	return { ...state, state, stop: () => controller.abort(), done };
}

async function until(check: () => boolean, ms = 2_000) {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("timed out");
		await Bun.sleep(2);
	}
}

/** Lets pending microtasks and timers run. */
const settle = () => Bun.sleep(20);

describe("a step's feed", () => {
	test("on its Walker: catch-up from the file, then live, then its end", async () => {
		write();
		write();
		const f = follow(w);
		await until(() => f.got.length === 2);
		write();
		await until(() => f.got.length === 3);
		end();
		await f.done;
		expect(f.got).toEqual([1, 2, 3]);
		expect(f.state.ended).toBe(true);
	});

	test("through the Host: catch-up then live, and the step's end closes it", async () => {
		write();
		write();
		const f = follow(v);
		await until(() => f.got.length === 2);
		write();
		await until(() => f.got.length === 3);
		write();
		end();
		await f.done;
		expect(f.got).toEqual([1, 2, 3, 4]);
		expect(f.state.ended).toBe(true);
		// The end went to H with the last entries.
		expect(pushes.at(-1)?.ended).toBe(true);
	});

	test("two followers share one pump on the Walker", async () => {
		write();
		const first = follow(v);
		const second = follow(h);
		await until(() => first.got.length === 1 && second.got.length === 1);
		write();
		await until(() => first.got.length === 2 && second.got.length === 2);
		expect(first.got).toEqual([1, 2]);
		expect(second.got).toEqual([1, 2]);
		// Each entry crossed the link once.
		expect(pushes.flatMap((p) => p.seqs)).toEqual([1, 2]);
		expect(h.wanted("w")).toEqual([{ ...STEP, afterSeq: 2 }]);
	});

	test("the last follower leaving stops the Walker's pushes", async () => {
		write();
		const first = follow(v);
		const second = follow(v);
		await until(() => first.got.length === 1 && second.got.length === 1);
		first.stop();
		await settle();
		write();
		await until(() => second.got.length === 2);
		second.stop();
		await settle();
		expect(h.wanted("w")).toEqual([]);
		const before = pushes.length;
		write();
		write();
		await settle();
		expect(pushes.length).toBe(before);
	});

	test("nobody follows: nothing crosses the link", async () => {
		write();
		write();
		end();
		await settle();
		expect(pushes).toEqual([]);
		expect(h.wanted("w")).toEqual([]);
	});

	test("a reconnect resumes from its cursor without duplicates or gaps", async () => {
		write();
		write();
		const first = follow(v);
		await until(() => first.got.length === 2);
		first.stop();
		await first.done;
		// Written while nobody watched: not sent.
		write();
		write();
		await settle();
		const sentWhileAway = pushes.flatMap((p) => p.seqs);
		expect(sentWhileAway).toEqual([1, 2]);
		const again = follow(v, first.got.at(-1));
		await until(() => again.got.length === 2);
		write();
		await until(() => again.got.length === 3);
		expect([...first.got, ...again.got]).toEqual([1, 2, 3, 4, 5]);
		// The Walker sent from where the Host's tail stopped.
		expect(pushes.flatMap((p) => p.seqs)).toEqual([1, 2, 3, 4, 5]);
	});

	test("a resend is harmless: the Host keeps each seq once", async () => {
		write();
		const f = follow(h);
		await until(() => f.got.length === 1);
		h.deliver("w", STEP, files.get(STEP.stepId) ?? [], false);
		write();
		await until(() => f.got.length === 2);
		expect(f.got).toEqual([1, 2]);
	});

	test("an entry pushed by a Device that does not walk the run is dropped", async () => {
		write();
		const f = follow(h);
		await until(() => f.got.length === 1);
		h.deliver(
			"intruder",
			STEP,
			[{ ...(files.get("step-1")?.[0] as TranscriptEntry), seq: 99 }],
			true,
		);
		await settle();
		expect(f.got).toEqual([1]);
		expect(f.state.ended).toBe(false);
	});

	test("an ended step whose copy is in the archive is read there, without the Walker", async () => {
		const entries = [write(), write()];
		end();
		endedOnH.add(STEP.stepId);
		archiveOnH.set(STEP.stepId, entries);
		const f = follow(v, 1);
		await f.done;
		expect(f.got).toEqual([2]);
		expect(f.state.ended).toBe(true);
		expect(pushes).toEqual([]);
	});

	test("an ended step whose copy has not landed yet comes from the Walker", async () => {
		write();
		write();
		end();
		endedOnH.add(STEP.stepId);
		const f = follow(v);
		await f.done;
		expect(f.got).toEqual([1, 2]);
		expect(f.state.ended).toBe(true);
	});

	test("a Walker refuses to pump a run it does not walk", async () => {
		const other = createTranscriptFeeds({
			watch: createRunBus().subscribe,
			selfId: async () => "someone-else",
			runOwner: owner,
			hostOf: async () => "h",
			stepEnded: async () => false,
			ownEntries: async () => files.get(STEP.stepId) ?? [],
			archived: async () => null,
		});
		const sent: number[] = [];
		const theirs = other.pumps(async (_s, entries) => {
			sent.push(...entries.map((e) => e.seq));
		});
		write();
		theirs.set([{ ...STEP, afterSeq: 0 }]);
		await settle();
		theirs.close();
		expect(sent).toEqual([]);
	});

	test("a run this Replica does not have is refused", async () => {
		const f = follow(v, 0, { ...STEP, runId: "nope" });
		await f.done;
		expect(String(f.state.error)).toContain(
			"Night Shift cannot find this run.",
		);
	});
});

describe("a viewer's transcript of a step (entries)", () => {
	/** Steps whose end reached V's log, and V's archive copies. */
	let endedOnV: Set<string>;
	let archiveOnV: Map<string, TranscriptEntry[]>;
	/** How often V asked for an archive copy, by step. */
	let asked: string[];
	/** The cursor of each call to V's upstream. */
	let follows: number[];
	/** How many of the next calls fail at once, and after how many entries the next one drops. */
	let failNext: number;
	let dropAfter: number | null;

	beforeEach(() => {
		endedOnV = new Set();
		archiveOnV = new Map();
		asked = [];
		follows = [];
		failNext = 0;
		dropAfter = null;
	});

	/** V, a viewer through H, with its own log and archive. */
	function viewer(upstream = true) {
		return createTranscriptFeeds({
			watch: createRunBus().subscribe,
			selfId: async () => "v",
			runOwner: owner,
			hostOf: async () => "h",
			stepEnded: async (s) => endedOnV.has(s.stepId),
			ownEntries: async () => [],
			archived: async (s) => {
				asked.push(s.stepId);
				return archiveOnV.get(s.stepId) ?? null;
			},
			...(upstream
				? {
						async *upstream(step, afterSeq, signal) {
							follows.push(afterSeq);
							if (failNext > 0) {
								failNext -= 1;
								throw new Error("The Host is away.");
							}
							let sent = 0;
							for await (const entry of h.follow(step, afterSeq, signal)) {
								if (sent === dropAfter) {
									dropAfter = null;
									throw new Error("The link dropped.");
								}
								sent += 1;
								yield entry;
							}
						},
					}
				: {}),
			retryMs: 5,
			graceMs: 20,
		});
	}

	/** Reads `entries` in the background, as `follow` above does. */
	function read(feeds: TranscriptFeeds, afterSeq = 0, step = STEP) {
		const controller = new AbortController();
		controllers.push(controller);
		const state = { got: [] as number[], ended: false, error: null as unknown };
		const done = (async () => {
			try {
				for await (const entry of feeds.entries(
					step,
					afterSeq,
					controller.signal,
				)) {
					state.got.push(entry.seq);
				}
				state.ended = !controller.signal.aborted;
			} catch (error) {
				state.error = error;
			}
		})();
		return { state, stop: () => controller.abort(), done };
	}

	test("an ended step comes from the archive whole, and nothing crosses the link", async () => {
		const written = [write(), write(), write()];
		end();
		endedOnV.add(STEP.stepId);
		archiveOnV.set(STEP.stepId, written);
		const r = read(viewer(), 1);
		await r.done;
		expect(r.state.got).toEqual([2, 3]);
		expect(r.state.ended).toBe(true);
		expect(follows).toEqual([]);
		expect(pushes).toEqual([]);
	});

	test("a running step goes from live to its end, and then it is whole", async () => {
		write();
		const r = read(viewer());
		await until(() => r.state.got.length === 1);
		write();
		await until(() => r.state.got.length === 2);
		write();
		end();
		await r.done;
		expect(r.state.got).toEqual([1, 2, 3]);
		expect(r.state.ended).toBe(true);
	});

	test("a feed that fails is tried again from its last entry, without duplicates or gaps", async () => {
		write();
		write();
		write();
		// The Host is away twice, then the link drops after two entries.
		failNext = 2;
		dropAfter = 2;
		const r = read(viewer());
		await until(() => r.state.got.length === 3);
		write();
		end();
		await r.done;
		expect(r.state.got).toEqual([1, 2, 3, 4]);
		expect(follows).toEqual([0, 0, 0, 2]);
	});

	test("an ended step whose feed stays silent is read from the archive once its copy lands", async () => {
		const written = [write(), write()];
		// The Walker is of an older version: it sends nothing.
		stopDemand();
		pumps.close();
		end();
		endedOnV.add(STEP.stepId);
		const r = read(viewer());
		await settle();
		expect(r.state.got).toEqual([]);
		archiveOnV.set(STEP.stepId, written);
		await r.done;
		expect(r.state.got).toEqual([1, 2]);
		expect(r.state.ended).toBe(true);
		// It looked in the archive, waited out the silence, and looked again.
		expect(asked.length).toBeGreaterThan(1);
	});

	test("an ended step without a copy and without a Host is tried again, not given up", async () => {
		write();
		end();
		endedOnV.add(STEP.stepId);
		const r = read(viewer(false));
		await settle();
		expect(r.state.error).toBeNull();
		expect(r.state.ended).toBe(false);
		archiveOnV.set(STEP.stepId, files.get(STEP.stepId) ?? []);
		await r.done;
		expect(r.state.got).toEqual([1]);
	});

	test("on its Walker: the own file, then live; a step moved here with no file comes from the archive", async () => {
		const moved = { ...STEP, stepId: "moved" };
		const fromBefore: TranscriptEntry = {
			...write(),
			stepId: "moved",
		};
		files.delete(STEP.stepId);
		endedOnW.add("moved");
		const walker = createTranscriptFeeds({
			watch: wBus.subscribe,
			selfId: async () => "w",
			runOwner: owner,
			hostOf: async () => "h",
			stepEnded: async (s) => endedOnW.has(s.stepId),
			ownEntries: async (s) => [...(files.get(s.stepId) ?? [])],
			archived: async (s) => (s.stepId === "moved" ? [fromBefore] : null),
		});
		const old = read(walker, 0, moved);
		await old.done;
		expect(old.state.got).toEqual([1]);

		write();
		const r = read(walker);
		await until(() => r.state.got.length === 1);
		write();
		end();
		await r.done;
		expect(r.state.got).toEqual([2, 3]);
		expect(pushes).toEqual([]);
	});

	test("a run this Replica does not have is refused", async () => {
		const r = read(viewer(), 0, { ...STEP, runId: "nope" });
		await r.done;
		expect(String(r.state.error)).toContain(
			"Night Shift cannot find this run.",
		);
		expect(r.state.got).toEqual([]);
	});
});
