import type {
	AgentErrorKind,
	AgentUsage,
	Effort,
	HarnessName,
	PermissionMode,
} from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import { event } from "@nightshift/db/schema/nightshift";

import type { RunStatus, SessionSummary } from "./types";

/**
 * Every fact the engine appends to the event log. Transcript chunks (text
 * deltas, tool calls) never go here: they live in the NDJSON transcript files.
 */
export type SessionOutcome = NonNullable<SessionSummary["outcome"]>;

export type EnginePayloads = {
	ProjectAdded: { projectId: string; name: string; repoPath: string };
	ProjectRemoved: { projectId: string };
	RunStarted: {
		projectId: string;
		prompt: string;
		harness: HarnessName;
		model: string;
		permissionMode: PermissionMode;
		effort: Effort | null;
	};
	WorktreeCreated: { worktreePath: string; branch: string; baseRef: string };
	SessionStarted: {
		prompt: string;
		/** The harness session this session continues, on a resume. */
		resumeSessionId: string | null;
		transcriptPath: string;
	};
	HarnessSessionAssigned: { harnessSessionId: string; model: string | null };
	StopRequested: Record<string, never>;
	SessionEnded: {
		outcome: SessionOutcome;
		error: string | null;
		errorKind: AgentErrorKind | null;
		usage: AgentUsage | null;
		costUsd: number | null;
		/** Epoch ms when a usage limit resets, when the harness reports it. */
		resetAt: number | null;
	};
};

export type EngineEventType = keyof EnginePayloads;

export type LoggedEvent = {
	[T in EngineEventType]: {
		seq: number;
		runId: string | null;
		sessionId: string | null;
		type: T;
		payload: EnginePayloads[T];
		at: number;
	};
}[EngineEventType];

export async function appendEvent<T extends EngineEventType>(
	db: Database,
	input: {
		type: T;
		payload: EnginePayloads[T];
		runId?: string | null;
		sessionId?: string | null;
	},
): Promise<void> {
	await db.insert(event).values({
		runId: input.runId ?? null,
		sessionId: input.sessionId ?? null,
		type: input.type,
		payload: JSON.stringify(input.payload),
	});
}

export function parseEventRow(row: typeof event.$inferSelect): LoggedEvent {
	return {
		seq: row.seq,
		runId: row.runId,
		sessionId: row.sessionId,
		type: row.type as EngineEventType,
		payload: JSON.parse(row.payload),
		at: row.at.getTime(),
	} as LoggedEvent;
}

/**
 * The status rule. Look at the latest `SessionStarted` of the run (by log
 * order). Without a matching `SessionEnded` the run is `running`; with one,
 * the status is that session's outcome. A run that never started a session
 * (the daemon died between creating the run and starting its session) is
 * `interrupted`.
 */
export function deriveRunStatus(events: readonly LoggedEvent[]): RunStatus {
	let latestStarted: string | null = null;
	let latestStartedSeq = -1;
	const outcomes = new Map<string, SessionOutcome>();
	for (const e of events) {
		if (!e.sessionId) continue;
		if (e.type === "SessionStarted" && e.seq > latestStartedSeq) {
			latestStarted = e.sessionId;
			latestStartedSeq = e.seq;
		} else if (e.type === "SessionEnded" && !outcomes.has(e.sessionId)) {
			outcomes.set(e.sessionId, e.payload.outcome);
		}
	}
	if (!latestStarted) return "interrupted";
	return outcomes.get(latestStarted) ?? "running";
}

/** The sum of the cost each ended session reported. */
export function sumCostUsd(events: readonly LoggedEvent[]): number {
	let total = 0;
	const counted = new Set<string>();
	for (const e of events) {
		if (e.type !== "SessionEnded" || !e.sessionId) continue;
		if (counted.has(e.sessionId)) continue;
		counted.add(e.sessionId);
		total += e.payload.costUsd ?? 0;
	}
	return total;
}

/** The first `SessionEnded` per session. Later duplicates are ignored. */
export function sessionEndings(
	events: readonly LoggedEvent[],
): Map<string, EnginePayloads["SessionEnded"]> {
	const endings = new Map<string, EnginePayloads["SessionEnded"]>();
	for (const e of events) {
		if (e.type !== "SessionEnded" || !e.sessionId) continue;
		if (!endings.has(e.sessionId)) endings.set(e.sessionId, e.payload);
	}
	return endings;
}

/** Session ids in the order their `SessionStarted` was logged. */
export function sessionStartOrder(events: readonly LoggedEvent[]): string[] {
	return [...events]
		.filter((e) => e.type === "SessionStarted" && e.sessionId)
		.sort((a, b) => a.seq - b.seq)
		.map((e) => e.sessionId as string);
}

/** Session ids that started but never ended: the daemon died while they ran. */
export function openSessions(
	events: readonly LoggedEvent[],
): { runId: string; sessionId: string }[] {
	const ended = new Set(
		events
			.filter((e) => e.type === "SessionEnded" && e.sessionId)
			.map((e) => e.sessionId as string),
	);
	return events
		.filter(
			(e) =>
				e.type === "SessionStarted" &&
				e.sessionId &&
				e.runId &&
				!ended.has(e.sessionId),
		)
		.map((e) => ({
			runId: e.runId as string,
			sessionId: e.sessionId as string,
		}));
}
