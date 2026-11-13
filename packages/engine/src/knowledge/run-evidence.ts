import type { Flow } from "@nightshift/flows";
import type { LearningRun, LearningSignal, LearningStep } from "./run-signals";

/**
 * What the Learner reads of a run (ADR 37): Markdown, bounded in size.
 * The run's facts (its flow, status and steps), why it is worth a look
 * (its signals), what went wrong and the end of those steps' transcripts,
 * what fixed it, what a person answered and why, the run before when a
 * signal names it, and the learnings the project has, so the Learner does
 * not propose them again. Pure: the caller reads the transcripts.
 */

/** The most characters of the whole evidence. */
export const MAX_EVIDENCE_CHARS = 24_000;

/** The parts' limits, so no part crowds out the others. */
const LIMITS = {
	/** Steps the list of steps names. The rest are counted. */
	steps: 40,
	/** Steps that went wrong with their transcript: the signals' first. */
	failures: 3,
	/** Characters of an error, a note, a summary or a reason. */
	text: 600,
	/** Lines and characters of the end of one transcript. */
	transcriptLines: 60,
	transcriptChars: 4_000,
	/** Characters of the learnings the project has. */
	known: 6_000,
};

/** The last lines of each step's transcript, by the step's id: what the caller read. */
export type StepTranscripts = ReadonlyMap<string, readonly string[]>;

export type LearningEvidenceInput = {
	run: LearningRun;
	/** The run of the same flow before it, when a signal names it. */
	previous: LearningRun | null;
	signals: readonly LearningSignal[];
	/** The ends of the transcripts of the steps the signals name, of both runs. */
	transcripts: StepTranscripts;
	/** The learnings the project has: kept, and waiting. */
	known: readonly string[];
};

const cut = (text: string, max: number) => {
	const flat = text.trim();
	return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

/** The node's label in the flows of the run, else its id. */
function labelOf(run: LearningRun, nodeId: string): string {
	const flows: Flow[] = [run.flow, ...Object.values(run.calledFlows)];
	for (const flow of flows) {
		const node = flow.nodes.find((each) => each.id === nodeId);
		if (node) return node.label ? `${node.label} (${nodeId})` : nodeId;
	}
	return nodeId;
}

/** What a step reported in words: its summary, note or log tail. */
function saidOf(step: LearningStep): string | null {
	for (const field of ["summary", "note", "log_tail"]) {
		const value = step.outputs[field];
		if (typeof value === "string" && value.trim() !== "") return value;
	}
	return null;
}

/** One line of the list of steps. */
function stepLine(run: LearningRun, step: LearningStep): string {
	const parts = [
		`- ${labelOf(run, step.nodeId)}, ${step.nodeType}, try ${step.visit}: ${step.outcome ?? "did not end"}.`,
	];
	if (step.error) parts.push(`Error: ${cut(step.error, 200)}`);
	return parts.join(" ");
}

/** The steps, at most `LIMITS.steps`: the first and the last when there are more. */
function stepList(run: LearningRun): string[] {
	const { steps } = run;
	if (steps.length <= LIMITS.steps) {
		return steps.map((step) => stepLine(run, step));
	}
	const head = Math.floor(LIMITS.steps / 4);
	const tail = LIMITS.steps - head;
	return [
		...steps.slice(0, head).map((step) => stepLine(run, step)),
		`- … ${steps.length - LIMITS.steps} more steps …`,
		...steps.slice(-tail).map((step) => stepLine(run, step)),
	];
}

/** Why the run is worth a look, in words. */
function signalLine(
	run: LearningRun,
	previous: LearningRun | null,
	signal: LearningSignal,
): string {
	const label = labelOf(run, signal.nodeId);
	switch (signal.kind) {
		case "fixed":
			return `- The step ${label} failed, and a later try of it worked.`;
		case "fixed-since":
			return `- The run before failed at ${previous ? labelOf(previous, signal.nodeId) : label}. This run passed it.`;
		case "same-failure":
			return `- This run failed at ${label}, as the run before did.`;
		case "asked":
			return `- The step ${label} needed a person.`;
		case "gate-reason":
			return `- A person answered ${label} and wrote why.`;
	}
}

/** One step that went wrong or that fixed it: its words, its error and its transcript's end. */
function stepBlock(
	run: LearningRun,
	step: LearningStep,
	heading: string,
	transcripts: StepTranscripts,
): string[] {
	const lines = [
		`### ${heading}: ${labelOf(run, step.nodeId)}, try ${step.visit}`,
		"",
		`Outcome: ${step.outcome ?? "did not end"}.`,
	];
	if (step.error) lines.push(`Error: ${cut(step.error, LIMITS.text)}`);
	const said = saidOf(step);
	if (said) lines.push(`It reported: ${cut(said, LIMITS.text)}`);
	const transcript = transcripts.get(step.id) ?? [];
	if (transcript.length > 0) {
		let tail = transcript.slice(-LIMITS.transcriptLines).join("\n");
		if (tail.length > LIMITS.transcriptChars) {
			tail = `…${tail.slice(-(LIMITS.transcriptChars - 1))}`;
		}
		lines.push("", "The end of its transcript:", "", "```text", tail, "```");
	}
	lines.push("");
	return lines;
}

const stepOf = (run: LearningRun, id: string) =>
	run.steps.find((step) => step.id === id) ?? null;

/** The learnings the project has, newest first, at most `LIMITS.known` characters. */
function knownList(known: readonly string[]): string[] {
	const lines: string[] = [];
	let size = 0;
	for (const note of known) {
		const line = `- ${cut(note, 300)}`;
		if (size + line.length > LIMITS.known) {
			lines.push(`- … ${known.length - lines.length} more`);
			break;
		}
		lines.push(line);
		size += line.length + 1;
	}
	return lines;
}

/** The evidence of one run, at most `MAX_EVIDENCE_CHARS` characters. */
export function learningEvidence(input: LearningEvidenceInput): string {
	const { run, previous, signals, transcripts, known } = input;
	const out: string[] = [
		"# The run",
		"",
		`Flow: ${run.flowName ?? "a quick run"}. Status: ${run.status}.`,
	];
	if (run.reason) out.push(`Why it ended so: ${cut(run.reason, LIMITS.text)}`);
	out.push(
		"",
		"## Why Night Shift looks at it",
		"",
		...signals.map((signal) => signalLine(run, previous, signal)),
		"",
		"## Its steps, in order",
		"",
		...stepList(run),
		"",
	);

	const answers = signals.filter((signal) => signal.kind === "gate-reason");
	if (answers.length > 0) {
		out.push("## What a person answered, and why", "");
		for (const answer of answers) {
			const step = stepOf(run, answer.stepId);
			const question = step?.gate ? cut(step.gate.question, 300) : null;
			out.push(
				`- ${labelOf(run, answer.nodeId)}${question ? ` asked: "${question}"` : ""}. The person chose "${answer.choice}" and wrote: "${cut(answer.note, LIMITS.text)}"`,
			);
		}
		out.push("");
	}

	const wrong: { run: LearningRun; step: LearningStep; heading: string }[] = [];
	const fixes: LearningStep[] = [];
	for (const signal of signals) {
		if (signal.kind === "fixed") {
			const failed = stepOf(run, signal.failedStepId);
			const fixed = stepOf(run, signal.fixedStepId);
			if (failed) wrong.push({ run, step: failed, heading: "Failed" });
			if (fixed) fixes.push(fixed);
		} else if (signal.kind === "same-failure") {
			const failed = stepOf(run, signal.stepId);
			if (failed) wrong.push({ run, step: failed, heading: "Failed" });
			const before = previous && stepOf(previous, signal.previousStepId);
			if (previous && before) {
				wrong.push({
					run: previous,
					step: before,
					heading: "Failed in the run before",
				});
			}
		} else if (signal.kind === "fixed-since") {
			const before = previous && stepOf(previous, signal.previousStepId);
			if (previous && before) {
				wrong.push({
					run: previous,
					step: before,
					heading: "Failed in the run before",
				});
			}
			const fixed = stepOf(run, signal.fixedStepId);
			if (fixed) fixes.push(fixed);
		} else if (signal.kind === "asked") {
			const asked = stepOf(run, signal.stepId);
			if (asked) wrong.push({ run, step: asked, heading: "Needed a person" });
		}
	}
	if (wrong.length > 0) {
		out.push("## What went wrong", "");
		for (const { run: of, step, heading } of wrong.slice(0, LIMITS.failures)) {
			out.push(...stepBlock(of, step, heading, transcripts));
		}
	}
	if (fixes.length > 0) {
		out.push("## What worked", "");
		for (const step of fixes.slice(0, LIMITS.failures)) {
			out.push(...stepBlock(run, step, "Worked", new Map()));
		}
	}

	out.push("## The learnings the project has", "");
	out.push(...(known.length > 0 ? knownList(known) : ["None yet."]));
	const text = out.join("\n").trimEnd();
	return text.length > MAX_EVIDENCE_CHARS
		? `${text.slice(0, MAX_EVIDENCE_CHARS - 1)}…`
		: text;
}

/** The steps whose transcript the evidence shows: those that went wrong, of both runs. */
export function evidenceSteps(signals: readonly LearningSignal[]): {
	run: string[];
	previous: string[];
} {
	const run: string[] = [];
	const previous: string[] = [];
	for (const signal of signals) {
		if (signal.kind === "fixed") run.push(signal.failedStepId);
		if (signal.kind === "asked") run.push(signal.stepId);
		if (signal.kind === "same-failure") {
			run.push(signal.stepId);
			previous.push(signal.previousStepId);
		}
		if (signal.kind === "fixed-since") previous.push(signal.previousStepId);
	}
	const first = (ids: string[]) => [...new Set(ids)].slice(0, LIMITS.failures);
	return { run: first(run), previous: first(previous) };
}
