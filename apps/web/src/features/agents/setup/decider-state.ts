/**
 * The setup of a decider (Q22) as the screen shows it: the step its job is
 * at, what the person can do next for each choice, and the words that name
 * it. Pure: the status comes from `deciderSetup.status`, which the screen
 * polls while a job runs.
 */
import type { DeciderSetupJob, DeciderSetupStatus } from "@/shared/api";

/** The two deciders the setup offers. */
export type DeciderChoice = "local" | "typesafe";

/** How the last try ended, under the choices. */
export type DeciderNote =
	| { tone: "done"; text: string }
	/** `output`: what Homebrew printed last, for the details. */
	| { tone: "problem"; text: string; output: string | null };

/** What the decider step shows. */
export type DeciderStep =
	/** Nothing runs: choose Local or TypeSafe Jev. */
	| { kind: "choose"; note: DeciderNote | null }
	| { kind: "installing"; since: number }
	/** Night Shift waits for Ollama, and starts it when it does not answer. */
	| { kind: "starting" }
	| { kind: "downloading"; percent: number };

/** The words for the decider new Decision nodes use. */
const DECIDER_WORDS: Record<string, string> = {
	ollama: "Ollama on this computer",
	typesafe: "TypeSafe Jev",
};

/** What a toast or a note says when a decider is ready. */
export function readyText(decider: string): string {
	return `New Decision nodes use ${DECIDER_WORDS[decider] ?? decider}.`;
}

/** The step of the setup, from its job. */
export function deciderStep(job: DeciderSetupJob): DeciderStep {
	switch (job.state) {
		case "idle":
		case "cancelled":
			return { kind: "choose", note: null };
		case "ready":
			return {
				kind: "choose",
				note: { tone: "done", text: readyText(job.decider) },
			};
		case "install-failed":
			return {
				kind: "choose",
				note: {
					tone: "problem",
					text: job.problem,
					output: job.output.trim() ? job.output : null,
				},
			};
		case "failed":
			return {
				kind: "choose",
				note: { tone: "problem", text: job.problem, output: null },
			};
		case "installing":
			return { kind: "installing", since: job.since };
		case "starting":
			return { kind: "starting" };
		case "downloading":
			return { kind: "downloading", percent: job.percent };
	}
}

/** The job still runs: the screen shows its progress and asks again soon. */
export function deciderRuns(job: DeciderSetupJob): boolean {
	return (
		job.state === "installing" ||
		job.state === "starting" ||
		job.state === "downloading"
	);
}

/**
 * The decider a job just made ready: it ran before and is ready now. Null
 * for a job that was ready already when the screen first saw it.
 */
export function justChosen(
	before: DeciderSetupJob | undefined,
	after: DeciderSetupJob,
): Extract<DeciderSetupJob, { state: "ready" }> | null {
	if (after.state !== "ready" || !before || !deciderRuns(before)) return null;
	return after;
}

/**
 * Whether the setup offers the decider step after an agent is ready: it can
 * act here, and the person has not chosen a decider yet.
 */
export function offerDecider(status: DeciderSetupStatus | undefined): boolean {
	return status?.available === true && !status.current.chosen;
}

/** The choice the step opens on: the decider new nodes use now. */
export function choiceOf(status: DeciderSetupStatus): DeciderChoice {
	return status.current.decider === "typesafe" ? "typesafe" : "local";
}

/** A download's size, as the person reads it: "about 2 GB". */
export function aboutSize(bytes: number): string {
	if (bytes >= 1e9) return `about ${Math.round(bytes / 1e9)} GB`;
	return `about ${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/** What the Local card says under its name. */
export function localSummary(status: DeciderSetupStatus): string {
	const { local } = status;
	if (local.answers && local.hasModel) {
		return "Private. No account. The model is on this computer.";
	}
	return `Private. No account. Downloads a model of ${aboutSize(local.bytes)}.`;
}

/** The main button of the Local choice: use it, install Ollama, or check again after a download. */
export type LocalAction =
	| { kind: "use" }
	| { kind: "install"; command: string }
	| { kind: "download"; url: string };

export function localAction(status: DeciderSetupStatus): LocalAction {
	const { install } = status.local;
	if (!install) return { kind: "use" };
	return install.kind === "brew"
		? { kind: "install", command: install.command }
		: { kind: "download", url: install.url };
}

/** The progress line of a download: "40% of about 2 GB". */
export function downloadLine(percent: number, bytes: number): string {
	return `${Math.round(percent)}% of ${aboutSize(bytes)}`;
}
