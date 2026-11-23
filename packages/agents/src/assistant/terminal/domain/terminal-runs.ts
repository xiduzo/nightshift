/**
 * The run side of `nightshift mcp`: what an agent or an orchestrator needs
 * to drive the runs. List and read runs, stop one, see the Gates that wait
 * for a person and answer one, and read what happened since a time. The
 * tools read and write through the same procedures as the web app, over a
 * `TerminalRunPort`.
 */
import type { Flow, ProjectFlowMap } from "@nightshift/flows";
import { iso, parseInstant } from "@nightshift/time";

/** The names of the run tools only the terminal has. */
export const RUN_TOOLS = {
	listRuns: "list_runs",
	stopRun: "stop_run",
	needsMe: "needs_me",
	answerGate: "answer_gate",
} as const;

/** The statuses a run can have, as `list_runs` filters them. */
export const RUN_STATUSES = [
	"running",
	"waiting",
	"sleeping",
	"finished",
	"failed",
	"stopped",
	"interrupted",
] as const;

export type TerminalRunStatus = (typeof RUN_STATUSES)[number];

/** What a run cost, as Night Shift knows it. */
export type TerminalCost = {
	usd: number;
	/** Part of it is priced from tokens. */
	estimated: boolean;
	/** How many calls did not say what they cost. */
	missing: number;
	/** How many calls could cost. */
	calls: number;
	/** How sure the cost is, when the run's metrics say. */
	basis: "billed" | "estimated" | "unknown" | null;
};

/** Run shape the terminal port returns for get_run (mirrors authoring). */
export type TerminalAuthoringRun = {
	id: string;
	status: string;
	reason: string | null;
	test?: { pinned: string[]; skipped: string[] };
	inputs: Record<string, unknown>;
	flow: Flow;
	steps: {
		id: string;
		flow: string | null;
		nodeId: string;
		nodeType: string;
		visit: number;
		outcome: string | null;
		error: string | null;
		note: string | null;
		test?: "pinned" | "skipped";
	}[];
	failedStepId: string | null;
	transcript: string[];
	transcriptHolds?: "so-far" | "cut";
};

/** A run in the list of `list_runs`. */
export type TerminalRunSummary = {
	id: string;
	flowName: string | null;
	title: string;
	status: string;
	reason: string | null;
	/** Epoch ms. */
	createdAt: number;
	/** Epoch ms. Null while it goes on. */
	endedAt: number | null;
	cost: TerminalCost;
	/** The pull request the run opened. */
	prUrl: string | null;
	/** A test run (ADR 27): the nodes its start pinned and skipped, by id. */
	test?: { pinned: string[]; skipped: string[] };
};

/** A Gate that waits for a person, as the Needs-you inbox shows it. */
export type TerminalGate = {
	runId: string;
	stepId: string;
	projectId: string;
	projectName: string;
	flowName: string | null;
	runTitle: string;
	/** The question, as the flow wrote it for this run. */
	question: string;
	choices: {
		name: string;
		description?: string;
		needsNote?: true;
		/** What happens when the person picks it. */
		impact?: string;
	}[];
	/** How soon it needs an answer. */
	urgency: "now" | "today" | "later";
	/** Why a person decides, what is done, and the option the flow recommends. */
	brief: {
		situation: string | null;
		background: { text: string; source: string | null }[];
		recommendation: { option: string | null; reason: string | null } | null;
	};
	/** Epoch ms. */
	openedAt: number;
	/** When nobody answers by `at`, Night Shift takes `choose`. */
	deadline: { at: number; choose: string } | null;
	/** Your role in the Gate's Space lets you answer it. */
	canAnswer: boolean;
	/** An answer is on its way. */
	answerPending: boolean;
};

/** What a run produced: the report of the End node that ended it (ADR 26). */
export type TerminalReport = {
	/** The End step that wrote it. */
	stepId: string;
	/** Markdown: the whole report, or its start when `partial`. */
	text: string;
	/** `text` is only the start of the report. */
	partial: boolean;
	/** Night Shift kept only the first 64 KB of a longer report. */
	cut: boolean;
};

/** What the run tools read and do: Night Shift on this computer. */
export type TerminalRunPort = {
	flows(projectId: string): Promise<ProjectFlowMap>;
	/** The newest runs of the project first, only of these statuses when given. */
	runs(
		projectId: string,
		query: { limit: number; statuses?: TerminalRunStatus[] },
	): Promise<TerminalRunSummary[]>;
	/** One run of the project, or null when it has no run of that id. */
	run(
		projectId: string,
		runId: string,
	): Promise<{
		run: TerminalAuthoringRun;
		flowName: string | null;
		cost: TerminalCost;
		prUrl: string | null;
		/** Null: the run ended without one, or has not ended. */
		report: TerminalReport | null;
	} | null>;
	/** Stops a run now, or after the step that runs now. */
	stopRun(runId: string, when: "now" | "after-step"): Promise<void>;
	/** The open Gates of every Space you are in, oldest first. */
	gates(): Promise<TerminalGate[]>;
	answerGate(answer: {
		runId: string;
		stepId: string;
		choice: string;
		note?: string;
	}): Promise<void>;
	/** Where a person opens the run, at the step when given. */
	runLink(runId: string, stepId?: string): string;
};

const _RUNS_DEFAULT = 10;
const _RUNS_MAX = 50;
/** At most this many characters of a run's report go into `get_run`. */
const REPORT_LIMIT = 8_000;

/**
 * The report of a run as the end of `get_run`: the Markdown, at most
 * {@link REPORT_LIMIT} characters, and where to read the rest.
 */
export function reportSection(report: TerminalReport, link: string): string {
	const long = report.text.length > REPORT_LIMIT;
	const text = long
		? report.text.slice(0, REPORT_LIMIT).trimEnd()
		: report.text.trimEnd();
	const notes = [
		...(long || report.partial
			? [`(Only the start of the report. Read all of it at ${link})`]
			: []),
		...(report.cut
			? ["(Night Shift kept the first 64 KB of this report.)"]
			: []),
	];
	return [
		"## The report of the run",
		"",
		"What the run produced, written by its End node:",
		"",
		text,
		...(notes.length > 0 ? ["", ...notes] : []),
	].join("\n");
}

export const projectProperty = {
	type: "string",
	description:
		"The project: its id or name from list_projects. Leave it out for the project of the folder you work in.",
};

export const sinceProperty = {
	type: "string",
	description:
		"A time: an ISO date or time (2026-10-30, 2026-10-30T07:00:00Z), or a span back from now (12h, 2d, 30m).",
};

const SPAN = /^(\d+(?:\.\d+)?)\s*(m|h|d)$/i;
const SPAN_MS = { m: 60_000, h: 60 * 60_000, d: 24 * 60 * 60_000 } as const;

/** Epoch ms of a `since` argument. Undefined: none given. Throws in plain words on a value it cannot read. */
export function sinceOf(value: unknown, now: number): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value === "string") {
		const span = SPAN.exec(value.trim());
		if (span) {
			const unit = (span[2] as string).toLowerCase() as keyof typeof SPAN_MS;
			return now - Number(span[1]) * SPAN_MS[unit];
		}
		const at = parseInstant(value);
		if (!Number.isNaN(at)) return at;
	}
	throw new Error(
		"Give `since` as an ISO date or time (2026-10-30T07:00:00Z) or a span back from now (12h, 2d).",
	);
}

function dollars(usd: number): string {
	return `$${usd.toFixed(2)}`;
}

/** What a run cost, with how sure it is. Null: nothing in it could cost. */
export function costText(cost: TerminalCost): string | null {
	if (cost.calls === 0 && cost.usd === 0) return null;
	const basis =
		cost.basis ??
		(cost.missing > 0 ? "unknown" : cost.estimated ? "estimated" : "billed");
	switch (basis) {
		case "unknown":
			return cost.usd > 0 ? `at least ${dollars(cost.usd)}` : "cost unknown";
		case "estimated":
			return `about ${dollars(cost.usd)}`;
		case "billed":
			return dollars(cost.usd);
	}
}

export const isoOrNull = (at: number | null): string | null =>
	at === null ? null : iso(at);

/** A Gate's id for the agent: its run and its step. */
export function gateIdOf(gate: { runId: string; stepId: string }): string {
	return `${gate.runId}:${gate.stepId}`;
}

export function parseGateId(value: unknown): { runId: string; stepId: string } {
	const text = typeof value === "string" ? value.trim() : "";
	const at = text.indexOf(":");
	if (at <= 0 || at === text.length - 1) {
		throw new Error(
			`Give the Gate's id in \`gate\`, as ${RUN_TOOLS.needsMe} gives it.`,
		);
	}
	return { runId: text.slice(0, at), stepId: text.slice(at + 1) };
}

export function statusesOf(value: unknown): TerminalRunStatus[] | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const given = Array.isArray(value) ? value : [value];
	const known = new Set<string>(RUN_STATUSES);
	const wrong = given.filter((s) => typeof s !== "string" || !known.has(s));
	if (wrong.length > 0 || given.length === 0) {
		throw new Error(
			`Give \`status\` as one or more of: ${RUN_STATUSES.join(", ")}.`,
		);
	}
	return given as TerminalRunStatus[];
}

/** The run tools over `port`, in the project `projectOf` finds for a call. */
