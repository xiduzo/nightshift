import {
	agoLabel,
	type OpenGate,
	type Project,
	type RunSummary,
	waitedText,
} from "@nightshift/client";

/**
 * What the Projects tab and a project page say about a project, without
 * React Native: how many Gates need you, its last run, where its copies
 * are and its remote. The words follow the inbox and the runs.
 */

type GateOf = Pick<OpenGate, "projectId" | "canAnswer">;
type RunOf = Pick<RunSummary, "id" | "projectId" | "createdAt">;

/** One project of the Projects tab: the Gates that need you in it, and its newest run. */
export type ProjectOverview<P, R> = {
	project: P;
	/** Open Gates of the project that you may answer. */
	needsYou: number;
	/** The newest run of the project, or null when it has none. */
	lastRun: R | null;
};

/** Each project with the Gates that need you in it and its newest run, in the order of `projects`. */
export function projectOverviews<
	P extends Pick<Project, "id">,
	R extends RunOf,
>(
	projects: readonly P[],
	gates: readonly GateOf[],
	runs: readonly R[],
): ProjectOverview<P, R>[] {
	const needsYou = new Map<string, number>();
	for (const gate of gates) {
		if (!gate.canAnswer) continue;
		needsYou.set(gate.projectId, (needsYou.get(gate.projectId) ?? 0) + 1);
	}
	const lastRun = new Map<string, R>();
	for (const run of runs) {
		const seen = lastRun.get(run.projectId);
		if (!seen || newerFirst(run, seen) < 0) lastRun.set(run.projectId, run);
	}
	return projects.map((project) => ({
		project,
		needsYou: needsYou.get(project.id) ?? 0,
		lastRun: lastRun.get(project.id) ?? null,
	}));
}

/** The newest run first. Two runs of the same moment keep one order. */
function newerFirst(a: RunOf, b: RunOf): number {
	return b.createdAt - a.createdAt || b.id.localeCompare(a.id);
}

/** The runs of a project, the newest first. */
export function newestFirst<R extends RunOf>(runs: readonly R[]): R[] {
	return [...runs].sort(newerFirst);
}

/** "Nothing needs you", "1 Gate needs you", "3 Gates need you". */
export function needsYouText(count: number): string {
	if (count === 0) return "Nothing needs you";
	return count === 1 ? "1 Gate needs you" : `${count} Gates need you`;
}

/** The muted line under the Projects title: "4 projects · 2 Gates need you". */
export function projectsSummary(projects: number, needsYou: number): string {
	const count = projects === 1 ? "1 project" : `${projects} projects`;
	return needsYou === 0 ? count : `${count} · ${needsYouText(needsYou)}`;
}

/** "Last run 3 h ago · website · WEB-142", or "No runs yet". */
export function lastRunText(
	run: Pick<RunSummary, "title" | "createdAt"> | null,
	now: number,
): string {
	if (!run) return "No runs yet";
	return `Last run ${agoLabel(run.createdAt, now)} · ${run.title}`;
}

/**
 * Which computers have a copy of the project: "On MacBook Pro", "On
 * MacBook Pro and Mac mini", "On 3 computers". Null when none has one.
 */
export function clonesText(
	clones: readonly Pick<Project["clones"][number], "deviceName">[],
): string | null {
	const names = clones.map((clone) => clone.deviceName ?? "a computer");
	if (names.length === 0) return null;
	if (names.length === 1) return `On ${names[0]}`;
	if (names.length === 2) return `On ${names[0]} and ${names[1]}`;
	return `On ${names.length} computers`;
}

/**
 * The parts of a remote such as `github.com/acme/app`: who owns it, and
 * the web address to open. Null for a project without a remote.
 */
export function remoteParts(
	remote: string | null,
): { owner: string | null; url: string } | null {
	const trimmed = remote?.trim().replace(/\/+$/, "");
	if (!trimmed) return null;
	const path = trimmed.replace(/^[a-z]+:\/\//i, "");
	const segments = path.split("/").filter(Boolean);
	// host/owner/repo: the owner is the segment before the repository.
	const owner = segments.length >= 3 ? (segments.at(-2) ?? null) : null;
	return { owner, url: `https://${path}` };
}

/**
 * The value at the end of a run row: how long a run on its way has
 * taken, or when an ended run started. With its spoken form.
 */
export function runTime(
	run: Pick<RunSummary, "status" | "createdAt">,
	now: number,
): { value: string; label: string } {
	const onItsWay =
		run.status === "running" ||
		run.status === "waiting" ||
		run.status === "sleeping";
	if (onItsWay) {
		const took = waitedText(now - run.createdAt);
		return { value: took, label: `started ${took} ago` };
	}
	const ago = agoLabel(run.createdAt, now);
	return { value: ago, label: `started ${ago}` };
}
