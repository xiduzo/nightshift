/** Ports and shapes the history tools of the chat read. Pure types. */
import type { FlowDiff, FlowDiffSummary } from "@nightshift/flows";
import type { AuthoringRun } from "./authoring";
/** What a run cost, as Night Shift knows it (mirrors terminal). */
export type TerminalCost = {
	usd: number;
	estimated: boolean;
	missing: number;
	calls: number;
	basis: "billed" | "estimated" | "unknown" | null;
};

export type TerminalRunStatus =
	| "running"
	| "waiting"
	| "sleeping"
	| "finished"
	| "failed"
	| "stopped"
	| "interrupted";

/** A run of the project in `list_runs`. */
export type HistoryRun = {
	id: string;
	/** Null for a quick run. */
	flow: string | null;
	title: string;
	status: string;
	/** How its End node says it came out: done, nothing-to-do or failed. Null when no End node ended it. */
	result: string | null;
	reason: string | null;
	/** What started it: a schedule, a person, a webhook. */
	startedBy: string;
	/** Epoch ms. */
	startedAt: number;
	/** Epoch ms. Null while it goes on. */
	endedAt: number | null;
	cost: TerminalCost;
	test?: { pinned: string[]; skipped: string[] };
};

/** What one step of a run cost and how long it took. */
export type HistoryStepCost = {
	stepId: string;
	nodeId: string;
	/** The called flow the step ran in. Null: the run's own flow. */
	flow: string | null;
	visit: number;
	usd: number;
	estimated: boolean;
	/** Calls that ended without a cost. */
	missing: number;
	/** Calls that could cost. With none, the step costs nothing. */
	calls: number;
	/** Null while it runs. */
	ms: number | null;
	/** How many agent sessions it took: over one after a resume or a wait. */
	sessions: number;
};

/** One run of the project with its cost. */
export type HistoryRunDetail = {
	run: AuthoringRun;
	flowName: string | null;
	startedAt: number;
	endedAt: number | null;
	cost: TerminalCost;
	/** The revision of the flow the run started from, for `get_revision`. */
	revisionId: string | null;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	} | null;
	steps: HistoryStepCost[];
};

/** One revision of a flow in `list_revisions`. */
export type HistoryRevision = {
	id: string;
	at: number;
	/** save, restore, import, copy… */
	kind: string;
	/** Who saved it, by name. Null: no person did, or the name is not known. */
	by: string | null;
	current: boolean;
	changes: FlowDiffSummary | null;
};

/** What the history tools read: one project, read only. */
export type HistoryPort = {
	/** The flow the chat is in: the default of every `flow` argument. */
	flowName: string;
	/** The run the chat is about: the default of every `run` argument. */
	aboutRunId?: string;
	/** The newest runs of the project first. */
	runs(query: {
		flow?: string;
		statuses?: TerminalRunStatus[];
		limit: number;
	}): Promise<HistoryRun[]>;
	/** One run of the project, or null when it has no run of that id. */
	run(runId: string): Promise<HistoryRunDetail | null>;
	/** The end of one step's transcript. `step`: a step id, or a node id for its last visit. Null: no such step. */
	transcript(
		runId: string,
		step: string,
	): Promise<{
		nodeId: string;
		lines: string[];
		holds: "whole" | "so-far" | "cut";
	} | null>;
	/** What the project's flows cost over the last `days`, as data to print. */
	spend(days: number): Promise<unknown>;
	/** The revisions of a flow, newest first. Null: the project has no such flow. */
	revisions(flow: string): Promise<HistoryRevision[] | null>;
	/** One revision: its flow, and the diff to it from `against` (another revision, else the one before it). */
	revision(
		flow: string,
		revisionId: string,
		against?: string,
	): Promise<{
		revision: HistoryRevision;
		against: string | null;
		diff: FlowDiff | null;
		flow: unknown;
	} | null>;
};
