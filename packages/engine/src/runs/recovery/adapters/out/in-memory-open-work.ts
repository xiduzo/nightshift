import { openWork as whatIsOpen } from "../../../../graph";
import {
	type EngineEventType,
	foldRun,
	type LoggedEvent,
} from "../../../../log";
import type { OpenWork } from "../../application/ports";
import { LIFECYCLE_EVENT_TYPES } from "../../domain/lifecycle-events";

/** The Walker the in-memory runs name when a test gives none: this computer. */
const THIS_COMPUTER = "this-computer";

/** What a cut by a dead daemon writes on a session and a step (`graph/runner/open-work.ts`). */
const STOPPED_WHILE_IT_RAN = "Night Shift stopped while this ran.";

const LIFECYCLE: ReadonlySet<string> = new Set(LIFECYCLE_EVENT_TYPES);

/** A run as the twin holds it: its whole log, its Walker, and whether it still arrives. */
type TwinRun = { events: LoggedEvent[]; walkerId: string; arriving: boolean };

/**
 * The work the last daemon left open, in memory. A test adds runs with
 * their logs (`add`). `close` ends the open sessions, the open steps and
 * a running run as a dead daemon's cut does, without the outputs a step's
 * node gives. It records what it closed and let go, and a test can make
 * the next let-go fail (`failNextLetGo`).
 */
export function inMemoryOpenWork(walkerId = THIS_COMPUTER) {
	const runs = new Map<string, TwinRun>();
	let letGoFails = false;
	let seq = 0;

	function append(
		runId: string,
		type: EngineEventType,
		payload: unknown,
		ids: { stepId?: string | null; sessionId?: string | null } = {},
	): void {
		const run = runs.get(runId);
		if (!run) throw new Error(`The twin has no run ${runId}.`);
		run.events.push({
			seq: ++seq,
			runId,
			stepId: ids.stepId ?? null,
			sessionId: ids.sessionId ?? null,
			type,
			payload,
			at: seq,
		} as LoggedEvent);
	}

	const twin = {
		/** Each cut, in order. */
		closed: [] as { runId: string; reason: string }[],
		/** The runs that let go of what they hold, in order. */
		letGone: [] as string[],
		/** Puts a run with its log in the twin. By default this computer walks it and it has arrived. */
		add(
			runId: string,
			events: readonly LoggedEvent[],
			options: { walkerId?: string; arriving?: boolean } = {},
		) {
			runs.set(runId, {
				events: [...events],
				walkerId: options.walkerId ?? walkerId,
				arriving: options.arriving ?? false,
			});
			for (const e of events) seq = Math.max(seq, e.seq);
		},
		/** The run's whole log now. */
		events(runId: string): LoggedEvent[] {
			return [...(runs.get(runId)?.events ?? [])];
		},
		/** The next let-go throws. */
		failNextLetGo() {
			letGoFails = true;
		},

		async walkedHere() {
			const byRun = new Map<string, LoggedEvent[]>();
			for (const [runId, run] of runs) {
				if (run.walkerId !== walkerId || run.arriving) continue;
				const lifecycle = run.events.filter((e) => LIFECYCLE.has(e.type));
				if (lifecycle.length > 0) byRun.set(runId, lifecycle);
			}
			return byRun;
		},
		async close(runId: string, cut: { kind: "interrupted"; reason: string }) {
			twin.closed.push({ runId, reason: cut.reason });
			const open = whatIsOpen(foldRun(twin.events(runId)), cut.kind);
			for (const session of open.sessions) {
				append(
					runId,
					"SessionEnded",
					{
						outcome: "interrupted",
						error: STOPPED_WHILE_IT_RAN,
						errorKind: null,
						usage: null,
						costUsd: null,
						resetAt: null,
					},
					{ stepId: session.stepId, sessionId: session.id },
				);
			}
			for (const step of open.steps) {
				append(
					runId,
					"StepEnded",
					{ outcome: "interrupted", outputs: {}, error: STOPPED_WHILE_IT_RAN },
					{ stepId: step.id },
				);
			}
			if (open.endsRun) {
				append(runId, "RunEnded", {
					status: "interrupted",
					reason: cut.reason,
				});
			}
		},
		async letGo(runId: string) {
			if (letGoFails) {
				letGoFails = false;
				throw new Error("The Host cannot be reached.");
			}
			twin.letGone.push(runId);
		},
	};
	return twin satisfies OpenWork;
}

export type InMemoryOpenWork = ReturnType<typeof inMemoryOpenWork>;
