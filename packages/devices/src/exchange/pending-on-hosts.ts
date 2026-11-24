import type { PendingElsewhere } from "../contract";
import type { CommandsChange } from "./commands";

/**
 * What this Device knows of the Commands that wait on its Hosts for other
 * Devices (`sync.pending`), in memory, per Host. An action on a run that
 * another Device walks waits on the Host until that Walker applies it.
 * Without this, this Device would show the Gate open again right after
 * its own answer went, and never hear of an answer from the phone, until
 * the Walker applies it.
 *
 * - Each set from a Host replaces what this Device knew of that Host.
 * - An action this Device just sent counts at once (`add`). The Host's
 *   next set replaces it. It also goes by itself after `sentMs`: the
 *   Host sends a set only when it changes, and the sets with this action
 *   may have come before it, the last one without it.
 * - A link that drops keeps the last set: the next one replaces it when
 *   the link is back. A reload starts empty and asks again.
 */
export type PendingOnHosts = {
	/** A Host's whole set: it replaces what this Device knew of that Host. */
	set(hostId: string, commands: readonly PendingElsewhere[]): void;
	/**
	 * An action this Device just sent to a Host, before that Host's next
	 * set. Only for a Host whose set this Device follows, and only when
	 * the set has no action of that kind for the run yet.
	 */
	add(hostId: string, command: PendingElsewhere): void;
	/** The Commands of these runs that wait on a Host, by run id, oldest first. */
	of(runIds: readonly string[]): Map<string, PendingElsewhere[]>;
	/**
	 * Calls `listener` with a run whose Commands on a Host changed, in the
	 * shape of `RunCommands.onChanged`. Returns the unsubscribe.
	 */
	onChanged(listener: (change: CommandsChange) => void): () => void;
};

/** How long an action this Device sent counts without the Host's word. */
const SENT_MS = 30_000;

export function createPendingOnHosts(
	options: {
		/** How long an action this Device sent counts without a new set. Default 30 s. */
		sentMs?: number;
		/** Runs `run` after `ms`. Returns how to cancel it. Default: a timer. */
		after?: (ms: number, run: () => void) => () => void;
	} = {},
): PendingOnHosts {
	const byHost = new Map<string, readonly PendingElsewhere[]>();
	const listeners = new Set<(change: CommandsChange) => void>();
	/** The actions this Device sent that no set replaced yet: how to cancel each one's end. */
	const sent = new Map<string, () => void>();
	const schedule =
		options.after ??
		((ms: number, run: () => void) => {
			const timer = setTimeout(run, ms);
			timer.unref?.();
			return () => clearTimeout(timer);
		});

	/** The ids of each run's Commands, as one string per run. */
	function idsByRun(commands: readonly PendingElsewhere[]) {
		const runs = new Map<string, { spaceId: string; ids: string[] }>();
		for (const c of commands) {
			const run = runs.get(c.runId) ?? {
				spaceId: c.spaceId,
				ids: [] as string[],
			};
			run.ids.push(c.id);
			runs.set(c.runId, run);
		}
		return new Map(
			[...runs].map(([runId, { spaceId, ids }]) => [
				runId,
				{ spaceId, ids: ids.sort().join() },
			]),
		);
	}

	/** Puts a Host's set in place, and tells of each run whose Commands changed. */
	function replace(hostId: string, next: readonly PendingElsewhere[]) {
		const before = idsByRun(byHost.get(hostId) ?? []);
		// A sent action the next set leaves out has no end to wait for.
		const kept = new Set(next.map((c) => c.id));
		for (const c of byHost.get(hostId) ?? []) {
			if (kept.has(c.id)) continue;
			sent.get(c.id)?.();
			sent.delete(c.id);
		}
		byHost.set(hostId, next);
		const after = idsByRun(next);
		const changes: CommandsChange[] = [];
		for (const [runId, run] of before) {
			if (after.get(runId)?.ids !== run.ids) {
				changes.push({ spaceId: run.spaceId, runId });
			}
		}
		for (const [runId, run] of after) {
			if (!before.has(runId)) changes.push({ spaceId: run.spaceId, runId });
		}
		for (const change of changes) {
			for (const listener of [...listeners]) listener(change);
		}
	}

	return {
		set(hostId, commands) {
			replace(hostId, [...commands]);
		},

		add(hostId, command) {
			const known = byHost.get(hostId);
			if (!known) return;
			// The Host's set may hold it already: its stream can come first.
			if (
				known.some((c) => c.runId === command.runId && c.kind === command.kind)
			) {
				return;
			}
			replace(hostId, [...known, command]);
			// No set may come after it: it goes by itself.
			sent.set(
				command.id,
				schedule(options.sentMs ?? SENT_MS, () => {
					sent.delete(command.id);
					const now = byHost.get(hostId);
					if (now?.some((c) => c.id === command.id)) {
						replace(
							hostId,
							now.filter((c) => c.id !== command.id),
						);
					}
				}),
			);
		},

		of(runIds) {
			const wanted = new Set(runIds);
			const runs = new Map<string, PendingElsewhere[]>();
			for (const commands of byHost.values()) {
				for (const c of commands) {
					if (!wanted.has(c.runId)) continue;
					const pending = runs.get(c.runId) ?? [];
					pending.push(c);
					runs.set(c.runId, pending);
				}
			}
			for (const pending of runs.values()) {
				pending.sort((x, y) => x.createdAt - y.createdAt);
			}
			return runs;
		},

		onChanged(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
