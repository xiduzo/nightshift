import { Refusal } from "@nightshift/refusal";
import { openWork as whatIsOpen } from "../../../../graph";
import {
	type EngineEventType,
	type EnginePayloads,
	foldRun,
	type LoggedEvent,
} from "../../../../log";
import { awaitsWorktree, runWorktree } from "../../../../read";
import type { Access } from "../../../access";
import { inMemoryRunRecords } from "../../../access/adapters/out/in-memory-run-records";
import { inMemoryRunFacts } from "../../../walk/adapters/out/in-memory-run-facts";
import { inMemoryTurns } from "../../../walk/adapters/out/in-memory-turns";
import { inMemoryOpenWork } from "./in-memory-open-work";
import { inMemoryWaits } from "./in-memory-waits";
import { inMemoryWorkplaces } from "./in-memory-workplaces";

/**
 * Every port of recovery at once, in memory, for a use-case test: the
 * twins of recovery's own ports, the walk's run facts and Turns, the runs
 * of access with a Night Shift `openRun` over them, start holds that
 * record each Space, and the pure functions of the mechanisms. Test code:
 * production code never imports this file.
 */
export function inMemoryRecoveryPorts() {
	const runs = inMemoryRunRecords();
	const openRun: Access["openRun"] = async (_actor, { runId }) => {
		const run = await runs.find(runId);
		if (!run)
			throw new Refusal("not-found", "Night Shift cannot find this run.");
		return { run, walkedHere: await runs.walkedHere(run) };
	};
	const holds = {
		/** The Spaces whose start hold a start waited in, and how it would wait when held. */
		started: [] as { spaceId: string; when: string | undefined }[],
		start<T>(
			spaceId: string,
			work: () => Promise<T>,
			when?: "refuse" | "wait",
		) {
			holds.started.push({ spaceId, when });
			return work();
		},
	};
	return {
		openWork: inMemoryOpenWork(),
		workplaces: inMemoryWorkplaces(),
		waits: inMemoryWaits(),
		facts: inMemoryRunFacts(),
		turns: inMemoryTurns(),
		runs,
		openRun,
		holds,
		fold: foldRun,
		whatIsOpen,
		worktreeOf: runWorktree,
		awaitsWorktree,
	};
}

/**
 * A run's log for a test: each `push` appends one event with the next
 * seq. `state` folds it as the run log does.
 */
export function eventsOf(runId: string) {
	const events: LoggedEvent[] = [];
	const builder = {
		events,
		push<T extends EngineEventType>(
			type: T,
			payload: EnginePayloads[T],
			ids: { stepId?: string; sessionId?: string } = {},
		) {
			events.push({
				seq: events.length + 1,
				runId,
				stepId: ids.stepId ?? null,
				sessionId: ids.sessionId ?? null,
				type,
				payload,
				at: 1_000 + events.length,
			} as LoggedEvent);
			return builder;
		},
		state: () => foldRun(events),
	};
	return builder;
}
