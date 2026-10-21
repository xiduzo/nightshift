import {
	currentStep,
	flowLabel,
	hasEnded,
	nodeLabels,
	type RunDetail,
	type RunStatus,
	runStatusLabel,
	stepName,
	stepPosition,
} from "../runs";
import { type GlanceTone, glanceTone } from "./tone";

/**
 * One run's progress for the lock screen (a Live Activity on iOS, an
 * ongoing notification on Android): its flow, the step that runs now,
 * step x of y and the status. No inputs, no Gate question, no agent text.
 */
export type RunProgress = {
	runId: string;
	flow: string;
	status: RunStatus;
	statusText: string;
	tone: GlanceTone;
	/** The name of the step that runs or waits now. Null before the first step and after the run ends. */
	step: string | null;
	/** "Step 2 of 5" while the run is on its way, "Starting" before the first step, "Ran 4 of 5 steps" after it ends. */
	position: string;
	/** How far the run is, from 0 to 1, for a progress bar. */
	fraction: number;
	ended: boolean;
};

/** The run's progress from the run as `runs.get` returns it. */
export function runProgress(
	run: Pick<
		RunDetail,
		"id" | "flowName" | "status" | "steps" | "flow" | "calledFlows"
	>,
): RunProgress {
	const ended = hasEnded(run.status);
	const { at, of } = stepPosition(run.steps, run.flow);
	const top = run.steps.filter((step) => step.scope === null);
	const current = ended ? null : currentStep(top);
	const total = Math.max(of, 1);
	const position = ended
		? `Ran ${at} of ${of} ${of === 1 ? "step" : "steps"}`
		: at === 0
			? "Starting"
			: `Step ${Math.min(at, of)} of ${of}`;
	const fraction = run.status === "finished" ? 1 : Math.min(at, total) / total;
	return {
		runId: run.id,
		flow: flowLabel(run),
		status: run.status,
		statusText: runStatusLabel(run.status),
		tone: glanceTone(run.status),
		step: current ? stepName(current, nodeLabels(run)) : null,
		position,
		fraction,
		ended,
	};
}

/** Whether two progress values show the same thing: an update can be skipped. */
export function sameProgress(a: RunProgress, b: RunProgress): boolean {
	return (
		a.runId === b.runId &&
		a.flow === b.flow &&
		a.status === b.status &&
		a.step === b.step &&
		a.position === b.position &&
		a.fraction === b.fraction
	);
}
