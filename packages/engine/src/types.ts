import type {
	AgentEvent,
	AgentHarness,
	Effort,
	HarnessName,
	PermissionMode,
} from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";

/**
 * The engine's public contract. The API layer only calls this interface.
 * Slice 1: a run is one Agent node in its own worktree, with stop and resume.
 */

/** Derived from the event log, never stored. */
export type RunStatus =
	| "running" // a session is in progress
	| "finished" // the last session ended normally
	| "stopped" // a person stopped the last session
	| "failed" // the last session ended with a harness error or a usage limit
	| "interrupted"; // the daemon died while a session ran

export type Project = {
	id: string;
	name: string;
	repoPath: string;
	createdAt: number;
};

export type SessionSummary = {
	id: string;
	harnessSessionId: string | null;
	prompt: string;
	createdAt: number;
	/** Set when the session ended. */
	outcome: "finished" | "stopped" | "failed" | "interrupted" | null;
	error: string | null;
	costUsd: number | null;
};

export type RunSummary = {
	id: string;
	projectId: string;
	prompt: string;
	harness: HarnessName;
	model: string;
	permissionMode: PermissionMode;
	effort: Effort | null;
	worktreePath: string;
	branch: string;
	baseRef: string;
	status: RunStatus;
	createdAt: number;
	/** Sum over all sessions. */
	costUsd: number;
};

export type RunDetail = RunSummary & {
	sessions: SessionSummary[];
	/** The resume command a person can paste into a terminal to take over. */
	takeOverCommand: string | null;
};

/** One line of a transcript file. `seq` increases by one per run, across sessions. */
export type TranscriptEntry = {
	seq: number;
	sessionId: string;
	at: number;
	event: AgentEvent;
};

export type RunStreamItem =
	| { kind: "transcript"; entry: TranscriptEntry }
	| { kind: "status"; status: RunStatus };

export type StartRunInput = {
	projectId: string;
	prompt: string;
	model: string;
	permissionMode: PermissionMode;
	effort?: Effort;
	/** Git ref to branch the worktree from. Defaults to the clone's current HEAD. */
	baseRef?: string;
};

export interface Engine {
	listProjects(): Promise<Project[]>;
	/** Fails when the path is not the top level of a git repository. */
	addProject(input: { repoPath: string; name?: string }): Promise<Project>;
	removeProject(projectId: string): Promise<void>;

	listRuns(input?: { projectId?: string }): Promise<RunSummary[]>;
	getRun(runId: string): Promise<RunDetail>;

	/** Creates the worktree, starts the first session, and returns at once. */
	startRun(input: StartRunInput): Promise<RunSummary>;
	/** Aborts the running session. No-op when nothing runs. */
	stopRun(runId: string): Promise<void>;
	/** Starts a new session that resumes the last harness session id. Fails while a session runs. */
	resumeRun(runId: string, prompt?: string): Promise<void>;

	/**
	 * Replays the full transcript (all sessions, oldest first) from disk, then
	 * yields live items until the signal aborts. Emits the current status first.
	 * `afterSeq` skips entries the caller already has.
	 */
	watchRun(
		runId: string,
		options: { signal: AbortSignal; afterSeq?: number },
	): AsyncIterable<RunStreamItem>;
}

export type EngineOptions = {
	db: Database;
	harnesses: Partial<Record<HarnessName, AgentHarness>>;
	/** Root for transcripts and other on-disk state, for example ~/.nightshift. */
	dataDir: string;
	/** How many sessions may run at once, over all runs. Default 2. */
	maxConcurrentSessions?: number;
};
