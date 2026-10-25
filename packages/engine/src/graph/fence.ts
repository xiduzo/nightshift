import { AsyncLocalStorage } from "node:async_hooks";
import type { RunnableConfig } from "@langchain/core/runnables";
import type {
	ChannelVersions,
	Checkpoint,
	CheckpointMetadata,
	PendingWrite,
} from "@langchain/langgraph-checkpoint";
import type { Database } from "@nightshift/db";

import type { RunLog } from "../log";
import { LibsqlSaver } from "./checkpointer";

/**
 * The fence of one drive: the one check that keeps a drive a stop took the
 * run from out of the run's data.
 *
 * A stop does not wait for the drive to unwind (a harness that hangs, or a
 * process whose timers stopped, would hold it forever). It closes the
 * drive's fence and writes the run's end itself. A drive writes the run
 * only through its thread: the log (`StepContext.log`), the `step` and
 * `agent_session` rows (`StepContext.write`) and the checkpoint saver (the
 * thread's graph and every body graph in it). All go through the fence, so
 * a drive that wakes later, or never, writes nothing more: no `StepEnded`,
 * no `RunEnded`, no edge, no step, no session row, no checkpoint. Its first
 * write throws `FencedError`, and the runner drops the drive quietly.
 *
 * A write that started before the fence closed is in flight: `close`
 * resolves once those settled, so the stop reads the log after them and
 * never ends a step twice. A write made inside another write of the same
 * fence is part of it: a row and the event that names it are one write,
 * so a stop never lands between them.
 *
 * Transcript entries are not fenced: they are the harness's last words,
 * not facts of the run, and the harness was told to stop.
 */

/** A write of a drive whose fence is closed. */
export class FencedError extends Error {
	constructor(runId: string) {
		super(`The run ${runId} was stopped: this drive writes nothing more.`);
		this.name = "FencedError";
	}
}

export type Fence = {
	readonly closed: boolean;
	/**
	 * Runs one write, or throws `FencedError` once the fence is closed. A
	 * write inside `fn` is part of it: it runs even when the fence closed
	 * meanwhile, and `close` waits for the whole.
	 */
	write<T>(fn: () => Promise<T>): Promise<T>;
	/** Closes the fence. Resolves once the writes in flight settled. */
	close(): Promise<void>;
};

export function createFence(runId: string): Fence {
	let closed = false;
	const inFlight = new Set<Promise<unknown>>();
	/** Set inside a write of this fence. */
	const writing = new AsyncLocalStorage<true>();
	return {
		get closed() {
			return closed;
		},
		write<T>(fn: () => Promise<T>): Promise<T> {
			if (writing.getStore()) return fn();
			if (closed) return Promise.reject(new FencedError(runId));
			const promise = writing.run(true, fn);
			inFlight.add(promise);
			const done = () => inFlight.delete(promise);
			promise.then(done, done);
			return promise;
		},
		async close(): Promise<void> {
			closed = true;
			await Promise.allSettled([...inFlight]);
		},
	};
}

/** The run log as one drive writes it: `append` goes through the fence. */
export function fencedLog(log: RunLog, fence: Fence): RunLog {
	return {
		...log,
		append: (input) => fence.write(() => log.append(input)),
	};
}

/** The checkpoint saver of one drive: every write goes through the fence. */
export class FencedSaver extends LibsqlSaver {
	constructor(
		db: Database,
		private readonly fence: Fence,
	) {
		super(db.$client);
	}

	override put(
		config: RunnableConfig,
		checkpoint: Checkpoint,
		metadata: CheckpointMetadata,
		newVersions?: ChannelVersions,
	): Promise<RunnableConfig> {
		return this.fence.write(() =>
			super.put(config, checkpoint, metadata, newVersions),
		);
	}

	override putWrites(
		config: RunnableConfig,
		writes: PendingWrite[],
		taskId: string,
		taskPath?: string,
	): Promise<void> {
		return this.fence.write(() =>
			super.putWrites(config, writes, taskId, taskPath),
		);
	}

	override pruneThread(threadId: string): Promise<void> {
		return this.fence.write(() => super.pruneThread(threadId));
	}

	override deleteThread(threadId: string): Promise<void> {
		return this.fence.write(() => super.deleteThread(threadId));
	}
}
