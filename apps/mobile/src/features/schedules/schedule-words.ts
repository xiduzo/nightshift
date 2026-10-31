import {
	isPausedTonight,
	type NudgeProblem,
	type ScheduleSummary,
} from "@nightshift/client";

/** Whether the row shows it paused: a pause or a resume on its way wins over the list. */
export function shownPaused(
	schedule: ScheduleSummary,
	now: number,
	pending: "pause" | "resume" | undefined,
): boolean {
	if (pending === "pause") return true;
	if (pending === "resume") return false;
	return isPausedTonight(schedule, now);
}

export type Nudge = "pause" | "resume" | "runNow";

const TITLES: Record<Nudge, string> = {
	pause: "Pause tonight did not work",
	resume: "Undo pause did not work",
	runNow: "The run did not start",
};

/**
 * What to say when a nudge did not work: what happened, and how to fix
 * it. The Host's own words say why, except for an older Host, which does
 * not know the nudge at all.
 */
export function problemCopy(
	nudge: Nudge,
	problem: NudgeProblem,
	message: string,
): { title: string; message: string; fix?: string } {
	const title = TITLES[nudge];
	switch (problem) {
		case "host-outdated":
			return {
				title: "Your Host cannot do this yet",
				message:
					"Pause tonight and Run now need a newer Night Shift on your Host.",
				fix: "Update Night Shift on your Host. Until then, change schedules on your computer.",
			};
		case "busy":
			return { title, message, fix: "Open Runs to follow that run." };
		case "refused":
			return { title, message };
		case "forbidden":
			return {
				title,
				message,
				fix: "Ask an owner of this Space for a role that can start and stop runs.",
			};
		case "gone":
			return {
				title,
				message,
				fix: "Pull down to see the schedules again.",
			};
		case "other":
			return {
				title,
				message,
				fix: "Check that this phone is online, then try again.",
			};
	}
}
