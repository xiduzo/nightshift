import type {
	Derive,
	RunBus,
	RunLog,
	RunRow,
	TranscriptEntry,
} from "../../../../log";
import {
	deriveSteps,
	type RunStreamItem,
	runFacts,
	type StepTranscript,
} from "../../../../read";
import type { RunStatus } from "../../../../run-status";
import { type DeviceNamer, stepOf, toStepSummary } from "./run-pages";
import { followRunTranscript, type StepEntries } from "./run-transcript";

/**
 * The two reads of a run that follow its files: a step's saved
 * transcript, and the watch of a run (its status, its steps and its
 * transcript as they change). Both read the run's state through the run
 * log's `derive`, so every reader of a run shares one derivation per
 * append.
 */

/** What the two reads stand on. */
export type RunWatchPorts = {
	/** The run log: its derivations, and its events (kept in memory while a run is watched). */
	log: Pick<RunLog, "derive" | "events">;
	bus: RunBus;
	/** A step's transcript, wherever its run is walked (`RunsPort.stepEntries`). */
	stepEntries: StepEntries;
	/** The entries of a step's own transcript file on this Replica: none without one. */
	ownEntries(step: {
		spaceId: string;
		runId: string;
		stepId: string;
	}): Promise<TranscriptEntry[]>;
	/** Names the Devices a Space's runs name. */
	namer(spaceId: string, ids: readonly (string | null)[]): Promise<DeviceNamer>;
};

/** The run log's derivation of one run. */
async function one<T>(
	log: Pick<RunLog, "derive">,
	runId: string,
	fn: Derive<T>,
): Promise<T> {
	return (await log.derive([runId], fn)).get(runId) as T;
}

/**
 * One step's transcript as Night Shift saved it. A step that ended: all
 * of it, wherever the run was walked (`stepEntries` returns once the
 * transcript is whole). A step that still runs: what this computer's file
 * holds so far, which is nothing while another Device walks it. Aborting
 * `signal` ends the read with what came.
 */
export async function savedTranscript(
	ports: RunWatchPorts,
	row: RunRow,
	stepId: string,
	signal: AbortSignal,
): Promise<StepTranscript> {
	const step = stepOf(await one(ports.log, row.id, deriveSteps), stepId);
	const at = { spaceId: row.spaceId, runId: row.id, stepId };
	if (step.endedAt === null) {
		return { entries: await ports.ownEntries(at), holds: "so-far" };
	}
	const entries: TranscriptEntry[] = [];
	for await (const entry of ports.stepEntries(at, 0, signal)) {
		entries.push(entry);
	}
	return { entries, holds: signal.aborted ? "cut" : "whole" };
}

/**
 * The run's status, its steps and its transcript so far, then every
 * change as it happens, until `signal` aborts. Transcript entries up to
 * `afterSeq` are skipped. The transcript goes out in `seq` order
 * (`followRunTranscript`), wherever the run is walked. When it cannot
 * be read, the watch ends with that error: the viewer reads again from
 * its cursor.
 */
export async function* watchRun(
	ports: RunWatchPorts,
	runRow: RunRow,
	signal: AbortSignal,
	afterSeq: number,
): AsyncGenerator<RunStreamItem> {
	const { log, bus } = ports;
	const runId = runRow.id;
	if (signal.aborted) return;

	const queue: (
		| { kind: "transcript"; entry: TranscriptEntry }
		| { kind: "status-changed" }
		| { kind: "step-changed"; stepId: string }
		| { kind: "error"; error: unknown }
	)[] = [];
	let wakeWatcher: (() => void) | null = null;
	const notify = () => {
		const resolve = wakeWatcher;
		wakeWatcher = null;
		resolve?.();
	};
	// Subscribe before reading the log: no change of a step is missed.
	// The transcript has its own reader.
	const unsubscribe = bus.subscribe(runId, (item) => {
		if (item.kind === "transcript") return;
		queue.push(item);
		notify();
	});
	const transcript = new AbortController();
	const stopTranscript = () => {
		transcript.abort();
		notify();
	};
	signal.addEventListener("abort", stopTranscript, { once: true });

	try {
		// Keeps the run's log in memory while it is open (`logOf`): each
		// change then derives from it, not from a read of every event.
		await log.events(runId);
		let lastStatus: RunStatus = (await one(log, runId, runFacts)).status;
		yield { kind: "status", status: lastStatus };

		// A copy: the steps the run log keeps are shared.
		const steps = [...(await one(log, runId, deriveSteps))];
		let deviceOf = await ports.namer(runRow.spaceId, [
			runRow.walkerId,
			...steps.map((s) => s.deviceId),
		]);
		for (const derived of steps) {
			if (signal.aborted) return;
			yield { kind: "step", step: toStepSummary(derived, deviceOf) };
		}

		void (async () => {
			try {
				for await (const entry of followRunTranscript(
					{ log, bus, stepEntries: ports.stepEntries },
					runRow,
					afterSeq,
					transcript.signal,
				)) {
					queue.push({ kind: "transcript", entry });
					notify();
				}
			} catch (error) {
				if (transcript.signal.aborted) return;
				queue.push({ kind: "error", error });
				notify();
			}
		})();

		while (!signal.aborted) {
			const item = queue.shift();
			if (!item) {
				await new Promise<void>((resolve) => {
					wakeWatcher = resolve;
				});
				continue;
			}
			if (item.kind === "transcript") {
				yield item;
			} else if (item.kind === "error") {
				throw item.error;
			} else if (item.kind === "step-changed") {
				const current = (await one(log, runId, deriveSteps)).find(
					(s) => s.id === item.stepId,
				);
				if (current) {
					if (
						current.deviceId !== null &&
						!steps.some((s) => s.deviceId === current.deviceId)
					) {
						steps.push(current);
						deviceOf = await ports.namer(runRow.spaceId, [
							runRow.walkerId,
							...steps.map((s) => s.deviceId),
						]);
					}
					yield { kind: "step", step: toStepSummary(current, deviceOf) };
				}
			} else {
				const status = (await one(log, runId, runFacts)).status;
				if (status !== lastStatus) {
					lastStatus = status;
					yield { kind: "status", status };
				}
			}
		}
	} finally {
		unsubscribe();
		transcript.abort();
		signal.removeEventListener("abort", stopTranscript);
	}
}
