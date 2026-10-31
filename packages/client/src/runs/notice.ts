import { runActions } from "./actions";
import type { RunResult, RunStatus, RunSummary } from "./types";

/** How a run that ended came out: the look of its notice. */
export type StoppedTone =
	| "done"
	| "nothing-to-do"
	| "ended-failed"
	| "failed"
	| "interrupted"
	| "stopped";

/** What a screen says about a run that ended, and whether it offers to resume it. */
export type StoppedNotice = {
	tone: StoppedTone;
	title: string;
	/** One line, for a place that shows only the gist. */
	gist: string;
	/** The whole text: the reason, and what you can do. */
	body: string;
	/** The run allows a resume from the computer that shows it. */
	resumable: boolean;
};

/** The name of the computer that runs a run, as people read it (as the web devices say it). */
function walkerName(walker: RunSummary["walker"]): string {
	return walker.name ?? "another device";
}

function firstLine(text: string | null | undefined): string | undefined {
	return text
		?.split("\n")
		.find((line) => line.trim())
		?.trim();
}

/**
 * Why a run ended and what you can do now: "The run stopped. Resume it to
 * continue." A run another computer walks says only that computer can
 * resume it. Null while the run is on its way, and for a run that finished
 * without a message from an End node.
 */
export function stoppedNotice(
	run: {
		reason: string | null;
		result: RunResult | null;
		walker: RunSummary["walker"];
	},
	status: RunStatus,
): StoppedNotice | null {
	// A run of another device: only it resumes.
	const elsewhere = run.walker.thisDevice ? null : walkerName(run.walker);
	const { resume } = runActions(status, run.walker.thisDevice, run.result);
	const resumeHere = elsewhere
		? `Only ${elsewhere} can resume it.`
		: "Resume it to continue.";
	const continueHere = elsewhere
		? resumeHere
		: "Resume it to continue where it stopped.";
	switch (status) {
		case "finished":
			// Only an End node with a message leaves you something to read.
			if (!run.result || !run.reason) return null;
			return {
				tone: run.result === "nothing-to-do" ? "nothing-to-do" : "done",
				title: run.result === "nothing-to-do" ? "Nothing to do" : "Done",
				gist: firstLine(run.reason) ?? "",
				body: run.reason,
				resumable: false,
			};
		case "failed":
			if (run.result === "failed") {
				return {
					tone: "ended-failed",
					title: "The flow ended as failed",
					gist: firstLine(run.reason) ?? "Run it again from a step.",
					body: `${run.reason ?? "The flow chose to end the run here as failed."}\nFix what it found, then run it again from a step.`,
					resumable: false,
				};
			}
			return {
				tone: "failed",
				title: "The run failed",
				gist: firstLine(run.reason) ?? resumeHere,
				body: run.reason ?? `The run failed. ${resumeHere}`,
				resumable: resume,
			};
		case "interrupted":
			return {
				tone: "interrupted",
				title: "The run was interrupted",
				gist: firstLine(run.reason) ?? "Night Shift stopped during this run.",
				body: `${run.reason ?? "Night Shift stopped during this run."} ${continueHere}`,
				resumable: resume,
			};
		case "stopped":
			return {
				tone: "stopped",
				title: "The run stopped",
				gist: firstLine(run.reason) ?? resumeHere,
				body: run.reason ?? `The run stopped before its end. ${continueHere}`,
				resumable: resume,
			};
		default:
			return null;
	}
}
