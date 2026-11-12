import type { RunAction, RunActions } from "@nightshift/engine/run-status";

import { actedRunStatus, type RunActing, runActions, whyNot } from "./actions";
import { type RunStatusView, statusOf } from "./status";
import type {
	RunDetail,
	RunResult,
	RunStatus,
	RunSummary,
	StepSummary,
	WaitEvent,
} from "./types";

/**
 * Where one run is now and what it needs, for the screen of a run: the
 * run as read with what came on its stream since. It answers its status
 * (the live one, or the result of an action on its way), its word and
 * group, the actions it allows and why not, the Gate it waits at, and
 * the notice that says what it needs from you or why it ended. A screen
 * draws the answer: only the look (icons, colours, buttons) is its own.
 */

/** A wait the stream told of, with no wake after it. */
export type RunWait = Pick<
	Extract<WaitEvent, { type: "wait" }>,
	"reason" | "until" | "message" | "signal"
>;

/** What a screen knows of a run besides the run as read. */
export type RunLive = {
	/** The status the stream sent last. It wins over the run as read. */
	status?: RunStatus | null;
	/** The steps as they stand: the stream's laid over the run's (`mergeSteps`). The run's own when absent. */
	steps?: readonly StepSummary[];
	/** The wait the stream told of last, with no wake after it. */
	wait?: RunWait | null;
	/** An action of the person on its way: the run shows its result at once. */
	acting?: RunActing;
	/** The screen can show the run's report: a notice of an ended run offers it. */
	report?: boolean;
};

/**
 * A piece of a notice's words: plain text, a name from the flow in code
 * type (a node id, a signal), or a time of day the screen writes.
 */
export type NoticePart = string | { code: string } | { time: number };

/** What a notice is about. Each takes its own look. */
export type NoticeKind =
	| "answer-sent"
	| "gate"
	| "signal"
	| "wait"
	| "sleep"
	| "done"
	| "nothing-to-do"
	| "ended-failed"
	| "failed"
	| "interrupted"
	| "stopped";

/**
 * A button a notice offers: answer the Gate, open the inbox, send the
 * signal, wake the run now, read its report.
 */
export type NoticeAction =
	| "answer"
	| "open-inbox"
	| "send-signal"
	| "wake"
	| "read-report";

/** What a run needs from you now, or why it ended, in parts a screen draws. */
export type RunNotice = {
	kind: NoticeKind;
	title: NoticePart[];
	/** One line, for a place that shows only the gist. */
	gist: string;
	/** The whole text. Empty: only the buttons. */
	body: NoticePart[];
	/** The buttons, in order. */
	actions: NoticeAction[];
	/** The run allows a resume from the computer that shows it. */
	resumable: boolean;
	/** When a sleeping run wakes: a screen counts down to it. Null otherwise. */
	wakeAt: number | null;
	/** The signal the run waits for, which "send-signal" sends. */
	signal: string | null;
};

/** One run now, as its screen shows it. */
export type RunNow = RunStatusView & {
	/** The status the screen shows: the live one, or the result of an action on its way. */
	status: RunStatus;
	result: RunResult | null;
	/** What the run allows now, from its own status. */
	allows: RunActions;
	/** Why it does not allow each action, in a sentence. Null where it does. */
	whyNot: Readonly<Record<RunAction, string | null>>;
	/** The Gate the run waits at: the oldest open one. Null when it waits at none. */
	gate: StepSummary | null;
	/** What it needs from you now, or why it ended. Null while it walks. */
	notice: RunNotice | null;
};

/**
 * A run as read: a run's screen has its steps and commands, a row of a
 * list has neither. Without them a waiting run names no Gate, so it has
 * no notice.
 */
type RunRead = Pick<
	RunSummary,
	"status" | "result" | "reason" | "walker" | "wakeAt" | "signal"
> &
	Partial<Pick<RunDetail, "commands" | "steps">>;

/** The name of the device that walks a run, as people read it. */
export function walkerName(walker: Pick<RunSummary["walker"], "name">): string {
	return walker.name ?? "another device";
}

/**
 * Where one run is now and what it needs, from the run as read and what
 * came live: for a run's screen, and for a row of a list that offers an
 * action (`allows`).
 */
export function runNow(run: RunRead, live: RunLive = {}): RunNow {
	const own = live.status ?? run.status;
	const here = run.walker.thisDevice;
	const shown = actedRunStatus(
		{ status: own, result: run.result, walkedHere: here },
		live.acting ?? null,
	);
	const allows = runActions(own, here, run.result);
	const actions = Object.keys(allows) as RunAction[];
	const gate =
		shown.status === "waiting"
			? (openGates(live.steps ?? run.steps ?? [])[0] ?? null)
			: null;
	return {
		...statusOf(shown),
		status: shown.status,
		result: shown.result,
		allows,
		whyNot: Object.fromEntries(
			actions.map((action) => [action, whyNot(action, own, here, run.result)]),
		) as Record<RunAction, string | null>,
		gate,
		notice: noticeOf(run, shown.status, {
			gate,
			wait: live.wait ?? null,
			report: live.report ?? false,
		}),
	};
}

/**
 * The Gates that wait for a person, the oldest first: steps that ask a
 * person and have not ended, at any depth.
 */
export function openGates<
	T extends Pick<StepSummary, "gate" | "endedAt" | "startedAt">,
>(steps: readonly T[]): T[] {
	return steps
		.filter((step) => step.gate !== null && step.endedAt === null)
		.sort((a, b) => a.startedAt - b.startedAt);
}

const SLEEP_REASON: Record<RunWait["reason"], string> = {
	"usage-limit": "The agent hit its usage limit.",
	network: "The network is down.",
	duration: "The flow waits a while.",
	time: "The flow waits for a time.",
	command: "The flow waits for a command to pass.",
	signal: "The flow waits for a signal.",
	any: "The flow waits for a signal or a command to pass.",
	url: "The flow waits for a URL to answer.",
	"device-offline": "The device of the next step is offline.",
	lease: "The flow waits for a lease another run holds.",
};

/** A Wait node's own wait, not the run policy's. */
function isNodeWait(reason: RunWait["reason"]): boolean {
	return (
		reason !== "usage-limit" &&
		reason !== "network" &&
		reason !== "device-offline"
	);
}

/** How a sleeping run goes on: tries again, checks again, or continues. */
function sleepTail(wait: RunWait | null): string {
	if (wait?.reason === "command" || wait?.reason === "any") {
		return "It tries the command again";
	}
	if (wait?.reason === "device-offline")
		return "It checks for the device again";
	return wait && isNodeWait(wait.reason)
		? "It continues"
		: "It continues where it stopped";
}

function firstLine(text: string | null | undefined): string | undefined {
	return text
		?.split("\n")
		.find((line) => line.trim())
		?.trim();
}

/** A notice with no buttons, no resume, no wake time and no signal. */
function notice(
	kind: NoticeKind,
	title: NoticePart[],
	gist: string,
	body: NoticePart[],
	more: Partial<RunNotice> = {},
): RunNotice {
	return {
		kind,
		title,
		gist,
		body,
		actions: [],
		resumable: false,
		wakeAt: null,
		signal: null,
		...more,
	};
}

/** What the run needs from you now, or why it ended. */
function noticeOf(
	run: RunRead,
	status: RunStatus,
	{
		gate,
		wait,
		report,
	}: { gate: StepSummary | null; wait: RunWait | null; report: boolean },
): RunNotice | null {
	const allows = runActions(status, run.walker.thisDevice, run.result);
	switch (status) {
		case "waiting": {
			if (!gate) return null;
			// A run of another device: the answer goes to it.
			const elsewhere = run.walker.thisDevice ? null : walkerName(run.walker);
			if (
				elsewhere &&
				(run.commands ?? []).some((command) => command.kind === "gate.resolve")
			) {
				return notice(
					"answer-sent",
					["Answer sent"],
					`It applies when ${elsewhere} is online.`,
					[
						`Your answer is on its way to ${elsewhere}. The run continues when ${elsewhere} is online.`,
					],
				);
			}
			return notice(
				"gate",
				["Waiting for your answer"],
				`At the gate ${gate.nodeId}`,
				[
					"The run waits at the gate ",
					{ code: gate.nodeId },
					" until someone answers it.",
				],
				{ actions: ["answer", "open-inbox"] },
			);
		}
		case "sleeping": {
			const until = run.wakeAt ?? wait?.until ?? null;
			const signal = run.signal ?? wait?.signal ?? null;
			const at: NoticePart[] = until !== null ? [{ time: until }] : [];
			if (signal !== null) {
				return notice(
					"signal",
					["Waiting for signal ", { code: signal }],
					`Send ${signal} to continue.`,
					[
						"The flow continues when the run gets the signal ",
						{ code: signal },
						...(at.length > 0 ? [", or times out at ", ...at] : []),
						". Send it here, or from another system through the API.",
					],
					{ actions: ["send-signal"], wakeAt: until, signal },
				);
			}
			const reason = wait ? SLEEP_REASON[wait.reason] : "The run sleeps.";
			const nodeWait = wait ? isNodeWait(wait.reason) : false;
			return notice(
				nodeWait ? "wait" : "sleep",
				[nodeWait ? "Waiting" : "Sleeping"],
				reason,
				[
					`${reason} ${sleepTail(wait)}`,
					...(at.length > 0 ? [" at ", ...at] : []),
					".",
					...(wait?.message ? [`\n${wait.message}`] : []),
				],
				{ actions: allows.resume ? ["wake"] : [], wakeAt: until },
			);
		}
		case "finished":
		case "failed":
		case "interrupted":
		case "stopped": {
			const read: NoticeAction[] = report ? ["read-report"] : [];
			const ended = endedNotice(run, status, allows.resume);
			if (ended) return { ...ended, actions: read };
			// A run that finished without a message: its report is the word it left.
			if (!report || status !== "finished") return null;
			return finishedNotice(run.result, "The run wrote a report.", [], read);
		}
		default:
			return null;
	}
}

/** A finished run's notice: "Done", or quiet when it had nothing to do (`statusOf`). */
function finishedNotice(
	result: RunResult | null,
	gist: string,
	body: NoticePart[],
	actions: NoticeAction[] = [],
): RunNotice {
	const { key, word } = statusOf({ status: "finished", result });
	return key === "nothing-to-do"
		? notice("nothing-to-do", [word], gist, body, { actions })
		: notice("done", ["Done"], gist, body, { actions });
}

/**
 * Why a run ended and what you can do now: "The run stopped. Resume it
 * to continue." Null for a run that finished without a message from an
 * End node.
 */
function endedNotice(
	run: Pick<RunRead, "reason" | "result">,
	status: "finished" | "failed" | "interrupted" | "stopped",
	resume: boolean,
): RunNotice | null {
	const resumeHere = "Resume it to continue.";
	const continueHere = "Resume it to continue where it stopped.";
	switch (status) {
		case "finished": {
			// Only an End node with a message leaves you something to read.
			if (!run.result || !run.reason) return null;
			return finishedNotice(run.result, firstLine(run.reason) ?? "", [
				run.reason,
			]);
		}
		case "failed":
			if (run.result === "failed") {
				return notice(
					"ended-failed",
					["The flow ended as failed"],
					firstLine(run.reason) ?? "Run it again from a step.",
					[
						`${run.reason ?? "The flow chose to end the run here as failed."}\nFix what it found, then run it again from a step.`,
					],
				);
			}
			return notice(
				"failed",
				["The run failed"],
				firstLine(run.reason) ?? resumeHere,
				[run.reason ?? `The run failed. ${resumeHere}`],
				{ resumable: resume },
			);
		case "interrupted":
			return notice(
				"interrupted",
				["The run was interrupted"],
				firstLine(run.reason) ?? "Night Shift stopped during this run.",
				[
					`${run.reason ?? "Night Shift stopped during this run."} ${continueHere}`,
				],
				{ resumable: resume },
			);
		case "stopped":
			return notice(
				"stopped",
				["The run stopped"],
				firstLine(run.reason) ?? resumeHere,
				[run.reason ?? `The run stopped before its end. ${continueHere}`],
				{ resumable: resume },
			);
	}
}
