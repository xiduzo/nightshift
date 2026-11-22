import { NIGHT_SHIFT } from "../../../contract";
import type { TranscriptEntry } from "../../../log";
import { evidenceSteps, learningEvidence } from "../domain/evidence";
import {
	type LookQueue,
	NOTHING,
	RECENT_RUNS,
	type RunLookBack,
	runBefore,
	TRANSCRIPT_LINES,
} from "../domain/look-back";
import { type LearningRun, learningSignals } from "../domain/signals";
import type { AskLearner, RunsToLearnFrom } from "./ports";
import type { ProposeFromRun } from "./propose-from-run";

export type LookBackAtRunPorts = {
	runs: Pick<RunsToLearnFrom, "space">;
	/** The Learner of this computer. A failure is logged by the caller: the run is not looked at again. */
	learn: AskLearner;
	/** The plain lines of a transcript's end: `transcriptLines` of the read model. */
	lines: (entries: readonly TranscriptEntry[], max: number) => string[];
	/** How long one look may take. */
	timeoutMs: number;
	/** One look at a time. The wire makes it once per look back. */
	queue: LookQueue;
	/** `readLearnsFromRuns`, bound by the wire. */
	learnsFromRuns(request: { projectId: string }): Promise<boolean>;
	/** `listKnownLearnings`, bound by the wire. */
	known(request: { projectId: string }): Promise<string[]>;
	/** `proposeFromRun`, bound by the wire. */
	proposeFromRun(request: ProposeFromRun): Promise<void>;
};

/** The run to look back at, and its Space. */
export type LookBackAtRun = { spaceId: string; runId: string };

type SpaceRuns = ReturnType<RunsToLearnFrom["space"]>;

/**
 * Looks back at one run that ended (ADR 37), after every look before it.
 * Only a run with a signal is read further: a run without one costs
 * nothing, no evidence and no model. The Learner gets the evidence and
 * gives at most five notes, which wait in the run's own file for a
 * person's Keep or Delete. A test run, a run that did not end and a
 * project that turned it off get nothing.
 */
export const lookBackAtRun =
	(ports: LookBackAtRunPorts) =>
	(request: LookBackAtRun): Promise<RunLookBack> =>
		ports.queue.add(() => look(ports, request));

async function look(
	ports: LookBackAtRunPorts,
	{ spaceId, runId }: LookBackAtRun,
): Promise<RunLookBack> {
	const space = ports.runs.space(spaceId, NIGHT_SHIFT);
	const run = await space.getRun(runId);
	if (run.endedAt === null || run.test !== undefined) return NOTHING;
	if (!(await ports.learnsFromRuns({ projectId: run.projectId }))) {
		return NOTHING;
	}
	const previous = await previousOf(space, run);
	const signals = learningSignals(run, previous);
	if (signals.length === 0) return NOTHING;

	const signal = AbortSignal.timeout(ports.timeoutMs);
	const transcripts = new Map<string, readonly string[]>();
	const steps = evidenceSteps(signals);
	await transcriptsOf(ports, space, run.id, steps.run, signal, transcripts);
	if (previous) {
		await transcriptsOf(
			ports,
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
		transcripts,
		known: await ports.known({ projectId: run.projectId }),
	});
	const notes = await ports.learn({
		evidence,
		spaceId,
		projectId: run.projectId,
		runId: run.id,
		signal,
	});
	await ports.proposeFromRun({
		projectId: run.projectId,
		runId: run.id,
		notes,
	});
	return { signals, notes };
}

/** The run of the same flow that ended before `run`, or null. */
async function previousOf(
	space: SpaceRuns,
	run: Awaited<ReturnType<SpaceRuns["getRun"]>>,
): Promise<LearningRun | null> {
	if (run.flowName === null) return null;
	const before = runBefore(
		run,
		await space.listRuns({ projectId: run.projectId, limit: RECENT_RUNS }),
	);
	return before ? space.getRun(before.id).catch(() => null) : null;
}

/** The ends of the transcripts of `ids`. One that cannot be read has none. */
async function transcriptsOf(
	ports: Pick<LookBackAtRunPorts, "lines">,
	space: SpaceRuns,
	runId: string,
	ids: readonly string[],
	signal: AbortSignal,
	into: Map<string, readonly string[]>,
): Promise<void> {
	for (const stepId of ids) {
		const read = await space
			.stepTranscript(runId, stepId, signal)
			.catch(() => null);
		if (read) into.set(stepId, ports.lines(read.entries, TRANSCRIPT_LINES));
	}
}
