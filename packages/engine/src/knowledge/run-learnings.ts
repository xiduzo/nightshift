import type { TranscriptEntry } from "../log";
import type { Knowledge } from "./knowledge";
import {
	evidenceSteps,
	learningEvidence,
	type StepTranscripts,
} from "./run-evidence";
import {
	type LearningRun,
	type LearningSignal,
	learningSignals,
} from "./run-signals";

/**
 * Learnings from runs that ended (ADR 37): after a run this computer walks
 * ends, Night Shift looks back at it and proposes what to learn, into the
 * project's `learnings/proposed/` as the run's own file. Only a run with a
 * signal (`run-signals.ts`) is read further: a run without one costs
 * nothing, no evidence and no model. The Learner (a built-in agent the
 * caller wires, `learn`) gets the evidence (`run-evidence.ts`) and gives
 * at most five notes. They wait for a person's Keep or Delete, as a
 * step's do. A project can turn it off (`Knowledge.learnsFromRuns`).
 *
 * The Walker does it, so a Host looks back at its own runs and a Device at
 * the runs it walks: the run's transcripts are there. One look at a time:
 * many runs that end together wait in a queue. A look that fails is
 * logged, and the run is not looked at again.
 */

/** The run's facts as the look back reads them, with what finds the run before. */
type EndedRun = LearningRun & {
	projectId: string;
	createdAt: number;
	endedAt: number | null;
};

/** What the look back reads of the runs on this computer: the engine (`Engine`). */
export type RunsToLearnFrom = {
	/** Each run event that lands here. Only a run's end matters. */
	onLandedFacts(
		listener: (
			facts: readonly { kind: string; spaceId: string; runId: string }[],
		) => void,
	): () => void;
	/** Whether this computer walks the run. */
	runHere(runId: string): Promise<{ walkedHere: boolean } | null>;
	space(spaceId: string): {
		getRun(runId: string): Promise<EndedRun>;
		listRuns(input: { projectId: string; limit?: number }): Promise<
			{
				id: string;
				flowName: string | null;
				createdAt: number;
				endedAt: number | null;
			}[]
		>;
		stepTranscript(
			runId: string,
			stepId: string,
			signal: AbortSignal,
		): Promise<{ entries: TranscriptEntry[] }>;
	};
};

/** What the Learner is asked: the evidence of one run, and where its cost goes. */
export type AskLearner = (input: {
	evidence: string;
	spaceId: string;
	projectId: string;
	runId: string;
	signal: AbortSignal;
}) => Promise<string[]>;

export type RunLearningsDeps = {
	runs: RunsToLearnFrom;
	knowledge: Pick<
		Knowledge,
		"learnsFromRuns" | "knownLearnings" | "proposeFromRun"
	>;
	/** The Learner of this computer. A failure is logged: the run is not looked at again. */
	learn: AskLearner;
	/** The plain lines of a transcript's end: `transcriptLines` of the read model. */
	lines: (entries: readonly TranscriptEntry[], max: number) => string[];
	/** How long one look may take. Default 5 minutes. */
	timeoutMs?: number;
};

/** What one look at a run found. */
export type RunLookBack = {
	signals: LearningSignal[];
	/** The notes proposed. Empty: none, or the run was not looked at. */
	notes: string[];
};

export type RunLearnings = {
	/** Looks back at one run of a Space now, in the queue. */
	lookBack(spaceId: string, runId: string): Promise<RunLookBack>;
	/** Looks back at each run this computer walks when it ends. Returns the stop. */
	follow(): () => void;
	/** Resolves when every look in the queue is done. */
	idle(): Promise<void>;
};

/** Runs of the project the search for the run before reads, newest first. */
const RECENT_RUNS = 50;
/** Lines of each transcript the evidence shows at most. */
const TRANSCRIPT_LINES = 60;

const NOTHING: RunLookBack = { signals: [], notes: [] };

export function createRunLearnings(deps: RunLearningsDeps): RunLearnings {
	const { runs, knowledge } = deps;
	let queue: Promise<unknown> = Promise.resolve();

	/** The run of the same flow that ended before `run`, or null. */
	async function previousOf(
		space: ReturnType<RunsToLearnFrom["space"]>,
		run: EndedRun,
	): Promise<LearningRun | null> {
		if (run.flowName === null) return null;
		const recent = await space.listRuns({
			projectId: run.projectId,
			limit: RECENT_RUNS,
		});
		const before = recent
			.filter(
				(each) =>
					each.id !== run.id &&
					each.flowName === run.flowName &&
					each.endedAt !== null &&
					each.createdAt < run.createdAt,
			)
			.sort((a, b) => b.createdAt - a.createdAt)[0];
		return before ? space.getRun(before.id).catch(() => null) : null;
	}

	/** The ends of the transcripts of `ids`. One that cannot be read has none. */
	async function transcriptsOf(
		space: ReturnType<RunsToLearnFrom["space"]>,
		runId: string,
		ids: readonly string[],
		signal: AbortSignal,
		into: Map<string, readonly string[]>,
	): Promise<void> {
		for (const stepId of ids) {
			const read = await space
				.stepTranscript(runId, stepId, signal)
				.catch(() => null);
			if (read) into.set(stepId, deps.lines(read.entries, TRANSCRIPT_LINES));
		}
	}

	async function look(spaceId: string, runId: string): Promise<RunLookBack> {
		const space = runs.space(spaceId);
		const run = await space.getRun(runId);
		if (run.endedAt === null || run.test !== undefined) return NOTHING;
		if (!(await knowledge.learnsFromRuns(run.projectId))) return NOTHING;
		const previous = await previousOf(space, run);
		const signals = learningSignals(run, previous);
		if (signals.length === 0) return NOTHING;

		const signal = AbortSignal.timeout(deps.timeoutMs ?? 5 * 60_000);
		const transcripts = new Map<string, readonly string[]>();
		const steps = evidenceSteps(signals);
		await transcriptsOf(space, run.id, steps.run, signal, transcripts);
		if (previous) {
			await transcriptsOf(
				space,
				previous.id,
				steps.previous,
				signal,
				transcripts,
			);
		}
		const evidence = learningEvidence({
			run,
			previous,
			signals,
			transcripts: transcripts as StepTranscripts,
			known: await knowledge.knownLearnings(run.projectId),
		});
		const notes = await deps.learn({
			evidence,
			spaceId,
			projectId: run.projectId,
			runId: run.id,
			signal,
		});
		await knowledge.proposeFromRun(run.projectId, run.id, notes);
		return { signals, notes };
	}

	function lookBack(spaceId: string, runId: string): Promise<RunLookBack> {
		const next = queue.then(() => look(spaceId, runId));
		queue = next.catch(() => {});
		return next;
	}

	return {
		lookBack,
		follow() {
			return runs.onLandedFacts((facts) => {
				for (const fact of facts) {
					if (fact.kind !== "run-ended") continue;
					void (async () => {
						const here = await runs.runHere(fact.runId);
						if (!here?.walkedHere) return;
						await lookBack(fact.spaceId, fact.runId);
					})().catch((error: unknown) => {
						console.warn("Night Shift did not look back at a run:", error);
					});
				}
			});
		},
		async idle() {
			// A look that queues while this waits is waited for too.
			let last: Promise<unknown>;
			do {
				last = queue;
				await last;
			} while (last !== queue);
		},
	};
}
