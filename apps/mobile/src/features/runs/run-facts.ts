import {
	compactCount,
	costLabel,
	hasEnded,
	type ItemSummary,
	type RunActions,
	type RunDetail,
	type RunStatus,
	type StepChangedFiles,
	type StepSummary,
	type StoppedNotice,
	tokensSplit,
	waitedText,
} from "@nightshift/client";

/**
 * The run screen without React Native: its status line, its verdict, its
 * one main action and the others, what it cost and what it changed.
 * Which actions a run allows is the engine's rule (`runActions`).
 */

/** One fact tile: "Cost / $0.42". "—" when it is not known. */
export type RunFact = { label: string; value: string; sub?: string };

/** What a fact says when it is not known. */
const UNKNOWN = "—";

type Computer = Pick<RunDetail["device"], "name" | "thisDevice">;

/** The computer a run runs on, by its name. The Host when it has no name. */
export function computerName(device: Computer): string {
	if (device.name) return device.name;
	return device.thisDevice ? "your Host" : "another computer";
}

/** The cost tile: its value, and why it may be lower than the real cost. */
function costFact(
	run: Pick<
		RunDetail,
		"costUsd" | "costMissing" | "costCalls" | "costEstimated"
	>,
): RunFact {
	const known = costLabel(run);
	if (known === null) return { label: "Cost", value: UNKNOWN };
	return {
		label: "Cost",
		value: known,
		sub:
			run.costMissing > 0
				? "A step did not report its cost"
				: run.costEstimated
					? "Part of it is estimated"
					: undefined,
	};
}

/**
 * What the run cost: its cost, the tokens its agents used, and how long
 * it ran. A run on its way counts to `now`.
 */
export function runFacts(
	run: Pick<
		RunDetail,
		| "createdAt"
		| "endedAt"
		| "costUsd"
		| "costMissing"
		| "costCalls"
		| "costEstimated"
		| "metrics"
	>,
	{ status, now }: { status: RunStatus; now: number },
): RunFact[] {
	const tokens = run.metrics?.tokens;
	const split = tokensSplit(tokens);
	const ended = hasEnded(status);
	const end = ended ? run.endedAt : now;
	return [
		costFact(run),
		tokens && split !== null
			? {
					label: "Tokens",
					value: compactCount(tokens.input + tokens.output),
					sub: split,
				}
			: { label: "Tokens", value: UNKNOWN },
		end === null
			? { label: "Length", value: UNKNOWN }
			: {
					label: "Length",
					value: waitedText(end - run.createdAt),
					sub: ended ? undefined : "So far",
				},
	];
}

/**
 * The part of the status line after the status word: "started 04:20"
 * while the run is on its way, "ended 01:22 · ran 22 min" once it ended.
 * `time` writes a time of day.
 */
export function runTimeLine(
	run: Pick<RunDetail, "createdAt" | "endedAt">,
	status: RunStatus,
	time: (epochMs: number) => string,
): string {
	if (!hasEnded(status) || run.endedAt === null) {
		return `started ${time(run.createdAt)}`;
	}
	return `ended ${time(run.endedAt)} · ran ${waitedText(run.endedAt - run.createdAt)}`;
}

/** A link a step's item points to: a pull request, a ticket. */
export type RunLink = Pick<ItemSummary, "id" | "title" | "state" | "branch"> & {
	url: string;
};

/** The links of the run's items, once each, in the order the run made them. */
export function runLinks(
	steps: readonly Pick<StepSummary, "items">[],
): RunLink[] {
	const links = new Map<string, RunLink>();
	for (const step of steps) {
		for (const item of step.items) {
			if (item.url === null) continue;
			links.set(item.url, {
				id: item.id,
				title: item.title,
				state: item.state,
				branch: item.branch,
				url: item.url,
			});
		}
	}
	return [...links.values()];
}

/** What a link is: a pull request ("#415") or another page, and the site it opens on. */
export type LinkLook = {
	pullRequest: boolean;
	/** "#415": the number of a pull request. */
	number: string | null;
	/** "GitHub", "example.com". */
	site: string | null;
};

const SITES: Record<string, string> = {
	"github.com": "GitHub",
	"gitlab.com": "GitLab",
	"bitbucket.org": "Bitbucket",
};

/** What a link is, from its URL: "https://github.com/a/b/pull/415" is pull request #415 on GitHub. */
export function linkLook(url: string): LinkLook {
	const host = /^https?:\/\/(?:www\.)?([^/:?#]+)/i
		.exec(url)?.[1]
		?.toLowerCase();
	const pull = /\/(?:pull|pulls|merge_requests|pull-requests)\/(\d+)/.exec(url);
	return {
		pullRequest: pull !== null,
		number: pull?.[1] ? `#${pull[1]}` : null,
		site: host ? (SITES[host] ?? host) : null,
	};
}

/** The caption of a link row: "Pull request · opens on GitHub". */
export function linkCaption(look: LinkLook): string[] {
	return [
		look.pullRequest ? "Pull request" : "Link",
		look.site ? `opens on ${look.site}` : "opens in the browser",
	];
}

/**
 * The one sentence under the status line: the open Gate's question, where
 * the run is now, why it ended, or what it made.
 */
export function runVerdict({
	status,
	gateQuestion,
	step,
	computer,
	notice,
	pullRequests,
}: {
	status: RunStatus;
	/** The question of the Gate that waits, as plain text. */
	gateQuestion: string | null;
	/** The name of the step that runs now. */
	step: string | null;
	computer: string;
	notice: Pick<StoppedNotice, "gist"> | null;
	/** How many pull requests the run made. */
	pullRequests: number;
}): string | null {
	switch (status) {
		case "waiting":
			return gateQuestion ?? "A Gate waits for an answer.";
		case "running":
			return step
				? `Now at ${step}, on ${computer}.`
				: `It starts on ${computer}.`;
		case "sleeping":
			return `It waits on ${computer} and continues by itself.`;
		case "finished":
			if (notice?.gist) return notice.gist;
			if (pullRequests === 0) return "It finished without a pull request.";
			return pullRequests === 1
				? "It made 1 pull request."
				: `It made ${pullRequests} pull requests.`;
		default:
			return notice?.gist || null;
	}
}

/** The action a run offers besides its main one. */
export type RunActionKind = "stop" | "resume" | "restart" | "rerun";

/** The one main action of a run, full width under its verdict. */
export type PrimaryAction =
	| { kind: "answer"; stepId: string }
	| { kind: "stop" }
	| { kind: "resume"; label: string }
	| { kind: "rerun" }
	| { kind: "open"; url: string; label: string };

type ActionInput = {
	status: RunStatus;
	allows: Pick<RunActions, RunActionKind>;
	/** The open Gate of the run, when one waits. */
	gate: { stepId: string } | null;
	/** The step the run continues at: the last one that started. */
	resumeAt: string | null;
	/** A step that a restart starts again runs now. */
	canRestart: boolean;
	/** The run has a step to run again from. */
	canRerun: boolean;
	links: readonly RunLink[];
};

/**
 * The main action: answer the Gate that waits, stop a run on its way,
 * retry a run that failed, resume one that stopped, run one again that
 * cannot resume, or open the pull request a finished run made. None when
 * the run offers nothing.
 */
export function primaryAction({
	status,
	allows,
	gate,
	resumeAt,
	canRerun,
	links,
}: ActionInput): PrimaryAction | null {
	const ended = hasEnded(status);
	if (!ended && gate) return { kind: "answer", stepId: gate.stepId };
	if (!ended && allows.stop) return { kind: "stop" };
	if (status === "failed" && allows.resume) {
		return { kind: "resume", label: "Retry" };
	}
	if ((status === "stopped" || status === "interrupted") && allows.resume) {
		return {
			kind: "resume",
			label: resumeAt ? `Resume at ${resumeAt}` : "Resume run",
		};
	}
	if (ended && status !== "finished" && canRerun && allows.rerun) {
		return { kind: "rerun" };
	}
	if (status === "finished") {
		for (const link of links) {
			const look = linkLook(link.url);
			if (!look.pullRequest) continue;
			return {
				kind: "open",
				url: link.url,
				label: look.number ? `Open ${look.number}` : "Open the pull request",
			};
		}
	}
	return null;
}

/**
 * The actions the run allows besides its main one, in this order: resume,
 * run again, restart the step, stop.
 */
export function moreActions(
	input: ActionInput,
	primary: PrimaryAction | null,
): RunActionKind[] {
	const { allows } = input;
	const more: RunActionKind[] = [];
	if (allows.resume && primary?.kind !== "resume") more.push("resume");
	if (allows.rerun && input.canRerun && primary?.kind !== "rerun") {
		more.push("rerun");
	}
	if (allows.restart && input.canRestart) more.push("restart");
	if (allows.stop && primary?.kind !== "stop") more.push("stop");
	return more;
}

/** What a run changed, over all its steps: "6 files · +73 −31". */
export function changesSummary(
	groups: readonly Pick<
		StepChangedFiles,
		"files" | "added" | "removed" | "omitted"
	>[],
): string {
	const paths = new Set(groups.flatMap((g) => g.files.map((f) => f.path)));
	const count =
		paths.size + groups.reduce((sum, group) => sum + group.omitted, 0);
	const added = groups.reduce((sum, group) => sum + group.added, 0);
	const removed = groups.reduce((sum, group) => sum + group.removed, 0);
	return `${count === 1 ? "1 file" : `${count} files`} · +${added} −${removed}`;
}

/** "12 KB", "1.4 MB": the size of a file the run made. */
export function sizeLabel(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
