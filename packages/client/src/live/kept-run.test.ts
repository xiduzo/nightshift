import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import type { RunStatus, StepSummary, TranscriptEntry } from "../runs";
import {
	KEPT_RUN_MS,
	keepRunBatch,
	keptRunQuery,
	keptRunSeq,
} from "./kept-run";
import type { RunStreamBatch } from "./run-buffer";
import type { EntryFold } from "./run-state";

const entry = (seq: number) => ({ seq, stepId: "build" }) as TranscriptEntry;
const step = (id: string, status = "running") =>
	({ id, status }) as unknown as StepSummary;

/** Keeps the seqs, in order. */
const seqs: EntryFold<number[]> = {
	empty: () => [],
	add: (kept, entries) => [...kept, ...entries.map((one) => one.seq)],
};

/** Keeps how many entries came. */
const count: EntryFold<number> = {
	empty: () => 0,
	add: (kept, entries) => kept + entries.length,
};

const batch = (part: Partial<RunStreamBatch>): RunStreamBatch => ({
	entries: [],
	steps: [],
	status: null,
	lastSeq: null,
	...part,
});

const keptOf = <T>(client: QueryClient, runId: string, fold: EntryFold<T>) =>
	client.getQueryData(keptRunQuery(runId, fold).queryKey);

describe("what the query client keeps of a run's stream", () => {
	test("gathers the batches of a run, and the seq of its last entry", () => {
		const client = new QueryClient();
		keepRunBatch(
			client,
			"r1",
			seqs,
			batch({
				entries: [entry(1), entry(2)],
				steps: [step("build")],
				lastSeq: 2,
			}),
		);
		keepRunBatch(
			client,
			"r1",
			seqs,
			batch({ status: "finished" as RunStatus, lastSeq: 2 }),
		);
		keepRunBatch(
			client,
			"r1",
			seqs,
			batch({ entries: [entry(3)], lastSeq: 3 }),
		);

		const kept = keptOf(client, "r1", seqs);
		expect(kept?.state.entries).toEqual([1, 2, 3]);
		expect(kept?.state.status).toBe("finished");
		expect([...(kept?.state.steps.keys() ?? [])]).toEqual(["build"]);
		expect(keptRunSeq(client, "r1", seqs)).toBe(3);
	});

	test("a new follow starts from the start when nothing is kept", () => {
		const client = new QueryClient();
		expect(keptRunSeq(client, "r1", seqs)).toBeUndefined();
		// Only a step came: no entry to follow on from.
		keepRunBatch(client, "r1", seqs, batch({ steps: [step("build")] }));
		expect(keptRunSeq(client, "r1", seqs)).toBeUndefined();
	});

	test("an entry that came already goes: two follows of the same run do not repeat it", () => {
		const client = new QueryClient();
		keepRunBatch(
			client,
			"r1",
			seqs,
			batch({ entries: [entry(1), entry(2)], lastSeq: 2 }),
		);
		keepRunBatch(
			client,
			"r1",
			seqs,
			batch({ entries: [entry(2), entry(3)], lastSeq: 3 }),
		);
		expect(keptOf(client, "r1", seqs)?.state.entries).toEqual([1, 2, 3]);
	});

	test("each run and each fold keeps its own", () => {
		const client = new QueryClient();
		keepRunBatch(
			client,
			"r1",
			seqs,
			batch({ entries: [entry(1)], lastSeq: 1 }),
		);
		keepRunBatch(
			client,
			"r1",
			count,
			batch({ entries: [entry(1)], lastSeq: 1 }),
		);
		keepRunBatch(
			client,
			"r2",
			seqs,
			batch({ entries: [entry(7)], lastSeq: 7 }),
		);

		expect(keptOf(client, "r1", seqs)?.state.entries).toEqual([1]);
		expect(keptOf(client, "r1", count)?.state.entries).toBe(1);
		expect(keptOf(client, "r2", seqs)?.state.entries).toEqual([7]);
	});

	test("stays a few minutes after its screen closes, and is never read from the Host", () => {
		const client = new QueryClient();
		keepRunBatch(
			client,
			"r1",
			seqs,
			batch({ entries: [entry(1)], lastSeq: 1 }),
		);
		const query = client
			.getQueryCache()
			.find({ queryKey: keptRunQuery("r1", seqs).queryKey, exact: true });
		expect(query?.gcTime).toBe(KEPT_RUN_MS);
		expect(query?.isDisabled()).toBe(true);
	});
});
