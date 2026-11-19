import { RUN_NOT_FOUND, withoutPrivatePaths } from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import { ORPCError } from "@orpc/server";
import type { Caller, SyncBatch, SyncCursors } from "../contract";
import { forbidden, type HostShared } from "./host-deps";
import {
	ForeignRowsError,
	isEmpty,
	MissingProjectError,
	mergeCursors,
} from "./rows";
import type { HostExchange } from "./types";

/** How long a stream with nothing new waits before it looks again. */
const STREAM_IDLE_MS = 20_000;

/**
 * The run history of the `sync` procedures: rows in and out by cursor,
 * live, and the Commands for the runs a Device walks.
 */
export function hostSync(
	shared: HostShared,
): Pick<
	HostExchange,
	| "pull"
	| "stream"
	| "commands"
	| "pending"
	| "push"
	| "command"
	| "commandDone"
> {
	const { deps, door } = shared;
	const { engine, registry } = deps;
	const { exchange } = engine;

	/** The Person who owns a Walker, as this Host knows it. */
	async function ownerOf(walkerId: string): Promise<string | null> {
		if (walkerId === deps.selfId) return deps.ownerId;
		return (await registry.get(walkerId))?.ownerId ?? null;
	}

	/** The rows of `spaces` after `cursors` (default: the Person's Spaces), every Walker's but the Device's own. */
	async function batch(
		caller: Caller,
		cursors: SyncCursors,
		withCommands = true,
		spaces?: readonly string[],
	): Promise<SyncBatch> {
		const { rows, cursors: moved } = await exchange.rowsAfter({
			spaces: spaces ?? (await caller.spaces()),
			cursors,
			except: caller.deviceId,
		});
		const owners = new Map<string, string | null>();
		for (const walkerId of new Set(rows.runs.map((r) => r.walkerId))) {
			owners.set(walkerId, await ownerOf(walkerId));
		}
		return {
			rows: withoutPrivatePaths(
				rows,
				(walkerId) => owners.get(walkerId) === caller.personId,
			),
			cursors: moved,
			commands: withCommands
				? await exchange.commands.pendingFor(caller.deviceId)
				: [],
			follows: exchange.feeds.wanted(caller.deviceId),
		};
	}

	/**
	 * Resolves when rows land that the Device lacks (of `on.rows`' Spaces,
	 * another Walker's), the Commands change (with `commands`), the steps
	 * someone follows of the Device's runs change, the time is up, or the
	 * signal aborts.
	 */
	function change(
		signal: AbortSignal,
		deviceId: string,
		on: { rows: readonly string[] | null; commands: boolean },
	): Promise<void> {
		return new Promise((resolve) => {
			const done = () => {
				off();
				offFollows();
				clearTimeout(timer);
				signal.removeEventListener("abort", done);
				resolve();
			};
			const off = on.commands
				? exchange.commands.onChanged(done)
				: () => undefined;
			const offFollows = on.rows
				? exchange.feeds.onWanted(deviceId, done)
				: () => false;
			const timer = setTimeout(done, STREAM_IDLE_MS);
			// Not the rows this Device pushed: it has them.
			if (on.rows) {
				void exchange
					.landed(signal, STREAM_IDLE_MS, {
						spaces: on.rows,
						except: deviceId,
					})
					.then(done);
			}
			if (signal.aborted) done();
			else signal.addEventListener("abort", done, { once: true });
		});
	}

	/** The steps of the batch's follows, as one string to compare. */
	const followsOf = (batch: SyncBatch) =>
		batch.follows
			.map((f) => f.stepId)
			.sort()
			.join();

	return {
		pull: (caller, { cursors }) => batch(caller, cursors),

		async *stream(caller, input, signal) {
			let at = input.cursors;
			const withCommands = input.commands !== false;
			let sentCommands = "";
			let sentFollows = "";
			while (!signal?.aborted) {
				// Read again each cycle: a long stream follows a change of Membership.
				const spaces = await caller.spaces();
				const cycle = new AbortController();
				const signals = signal ? [signal, cycle.signal] : [cycle.signal];
				// Listen before reading, so nothing lands unseen between the two.
				const changed = change(AbortSignal.any(signals), caller.deviceId, {
					rows: spaces,
					commands: withCommands,
				});
				try {
					const next = await batch(caller, at, withCommands, spaces);
					const commands = next.commands.map((c) => c.id).join();
					const follows = followsOf(next);
					if (
						!isEmpty(next.rows) ||
						commands !== sentCommands ||
						follows !== sentFollows
					) {
						at = mergeCursors(at, next.cursors);
						sentCommands = commands;
						sentFollows = follows;
						yield next;
						continue;
					}
					await changed;
				} finally {
					cycle.abort();
				}
			}
		},

		async *commands(caller, signal) {
			let sent: string | null = null;
			while (!signal?.aborted) {
				const cycle = new AbortController();
				const signals = signal ? [signal, cycle.signal] : [cycle.signal];
				// Listen before reading, so no Command is kept unseen between the two.
				const changed = change(AbortSignal.any(signals), caller.deviceId, {
					rows: null,
					commands: true,
				});
				try {
					const commands = await exchange.commands.pendingFor(caller.deviceId);
					const ids = commands.map((c) => c.id).join();
					if (ids !== sent) {
						sent = ids;
						yield { commands };
						continue;
					}
					await changed;
				} finally {
					cycle.abort();
				}
			}
		},

		async *pending(caller, signal) {
			let sent: string | null = null;
			while (!signal?.aborted) {
				const cycle = new AbortController();
				const signals = signal ? [signal, cycle.signal] : [cycle.signal];
				// Listen before reading, so no Command is kept unseen between the two.
				const changed = change(AbortSignal.any(signals), caller.deviceId, {
					rows: null,
					commands: true,
				});
				try {
					// Read again each cycle: a long stream follows a change of Membership.
					const kept = await exchange.commands.pendingIn(
						await caller.spaces(),
						caller.deviceId,
					);
					// What it carries stays with its Walker: the others know it waits.
					const commands = kept.map(
						({ id, spaceId, runId, kind, createdAt }) => ({
							id,
							spaceId,
							runId,
							kind,
							createdAt,
						}),
					);
					const ids = commands.map((c) => c.id).join();
					if (ids !== sent) {
						sent = ids;
						yield { commands };
						continue;
					}
					await changed;
				} finally {
					cycle.abort();
				}
			}
		},

		async push(caller, rows) {
			try {
				// Another Person's Device: its paths never land in this Replica.
				const kept =
					caller.personId === deps.ownerId ? rows : withoutPrivatePaths(rows);
				const added = await exchange.ingest(kept, {
					walker: caller.deviceId,
					spaces: await caller.spaces(),
				});
				return { events: added.length };
			} catch (error) {
				// A row of another Walker or Space: never taken. A project the
				// Space document has not brought yet: not yet.
				if (error instanceof ForeignRowsError) forbidden(error.message);
				if (error instanceof MissingProjectError) {
					throw new ORPCError("CONFLICT", { message: error.message });
				}
				throw error;
			}
		},

		async command(caller, input) {
			// Not a Member of the run's Space: not found. Their role: checked.
			await door.open(caller, input);
			const owner = await exchange.runOwner(input.runId);
			if (!owner) throw new Refusal("not-found", RUN_NOT_FOUND);
			if (owner.walkerId === deps.selfId) {
				// This Host walks the run: the action is a local one.
				await door.act(caller, owner.spaceId, input);
				return;
			}
			if (owner.walkerId === caller.deviceId) {
				forbidden("This device runs this run. Act on it there.");
			}
			await exchange.commands.enqueue({
				...input,
				spaceId: owner.spaceId,
				walkerId: owner.walkerId,
				personId: caller.personId,
			});
		},

		async commandDone(caller, input) {
			await exchange.commands.done(input.id, caller.deviceId, input.error);
		},
	};
}
