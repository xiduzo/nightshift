import type { Engine } from "@nightshift/engine";
import { ORPCError } from "@orpc/client";
import type { HostClient, RunCommand, RunRows } from "../contract";
import { type HostSpaces, type Link, pause } from "../links";
import { isEmpty, MissingProjectError } from "./rows";
import type { RunHistoryExchange } from "./run-history";

/**
 * This Device's half of the exchange of run history with one Host (the
 * Host's half is `HostExchange`; both go through `RunHistoryExchange`).
 * One per Host and engine. It runs as three streams of its Link
 * (`attach`), all outbound. The Link starts them when it is online, stops
 * them when it drops, and starts them again after a failure:
 *
 * - Push: the rows this computer walked in the Spaces the Host keeps,
 *   after the Host's cursor, whenever an event lands here (`sync.push`).
 *   After a batch with a node that ended, that step's transcript and
 *   command log, and its run's walk state, go to the Host's archive (the
 *   Host takes files of runs it has). The cursor moves when both are
 *   done: a batch that fails halfway goes again, whole.
 * - Pull: `sync.stream` from this Replica's cursors: other Walkers' rows
 *   as they land on the Host, each batch in one transaction. A batch whose
 *   project has not arrived yet (its Space document is on its way) waits
 *   for it, then the stream starts again from the same cursor. The stream
 *   also says which steps of this computer's runs someone follows: their
 *   live transcripts go to the Host (`archive.tail`) while they are
 *   wanted.
 * - Commands: `sync.commands`, the Commands for the runs this computer
 *   walks, on their own stream, so they never wait behind rows. A Host of
 *   an older version has none: its Commands come with the rows, and this
 *   stream waits until the link drops.
 *
 * A Command is checked again here, from this Replica, and applied like a
 * local action (`RunHistoryExchange.apply`); then the Host is told. It is
 * applied once: its id is in the event it writes, so the log says it was
 * applied, also after a restart. While it is applied it is noted in
 * memory (`AppliedCommands`), so a second stream that takes it meanwhile
 * waits for that result, also across a `bun --hot` reload.
 *
 * The Host offline: this computer keeps walking its runs. When the link
 * is back, every stream starts again at the cursors and catches up.
 */
export type DeviceExchange = {
	/** Pushes, pulls and applies over the link while it is online. Returns how to stop. */
	attach(link: Pick<Link, "stream">): () => void;
};

/**
 * The commands this computer applies for one Host, by id: what each
 * reports (null when it was applied), while the Host still sends it. A
 * command is in it from the moment it starts. It outlives the exchange:
 * the next one takes it over (`createDeviceExchange({ applied })`). The
 * log, not this map, says what was applied before a restart.
 */
export type AppliedCommands = Map<string, Promise<string | null>>;

export function createDeviceExchange(deps: {
	/** This Device's engine (`PeerEngine`): its run history and the Spaces its Hosts keep. */
	engine: Pick<Engine, "space"> & {
		exchange: RunHistoryExchange;
		hostSpaces: Pick<HostSpaces, "ofHost">;
	};
	hostId: string;
	/** This computer's Device id: the Walker of its runs. */
	selfId: string;
	/** The commands of the exchange before this one, which this one takes over. Default: none. */
	applied?: AppliedCommands;
	/** How long a batch waits for its project before the stream starts again. Default 30 s. */
	projectWaitMs?: number;
	/** How long the push loop waits for a new row before it looks again. Default 15 s. */
	idleMs?: number;
	/** How long a Command waits for the rows that move its run here. Default 30 s. */
	commandWaitMs?: number;
}): DeviceExchange {
	const { engine, hostId, selfId } = deps;
	const { exchange } = engine;
	const applied: AppliedCommands = deps.applied ?? new Map();

	/** The command's result: applied here once, by whichever stream takes it first. */
	function applyOnce(command: RunCommand): Promise<string | null> {
		const known = applied.get(command.id);
		if (known) return known;
		const result = exchange.apply(command, engine, {
			...(deps.commandWaitMs !== undefined
				? { waitMs: deps.commandWaitMs }
				: {}),
		});
		applied.set(command.id, result);
		// A failure to read the checks applies nothing: the stream tries again.
		result.catch(() => {
			if (applied.get(command.id) === result) applied.delete(command.id);
		});
		return result;
	}

	/**
	 * Applies the Commands that wait, in the Host's order, and reports each
	 * result once per stream (`reported`). `whole`: the set is every
	 * Command that waits, so one it lacks is done there.
	 */
	async function take(
		client: HostClient,
		commands: readonly RunCommand[],
		reported: Set<string>,
		whole: boolean,
		signal: AbortSignal,
	) {
		for (const command of commands) {
			if (reported.has(command.id)) continue;
			const error = await applyOnce(command);
			await client.sync.commandDone({ id: command.id, error }, { signal });
			reported.add(command.id);
		}
		const pending = new Set(commands.map((c) => c.id));
		for (const id of reported) {
			if (!pending.has(id)) reported.delete(id);
		}
		if (!whole) return;
		for (const id of applied.keys()) {
			if (!pending.has(id)) applied.delete(id);
		}
	}

	/** Sends this computer's rows, a batch at a time, until `signal` aborts. Throws when a batch fails. */
	async function push(client: HostClient, signal: AbortSignal) {
		while (!signal.aborted) {
			const cycle = new AbortController();
			const landed = exchange.landed(
				AbortSignal.any([signal, cycle.signal]),
				deps.idleMs ?? 15_000,
			);
			try {
				const spaces = await engine.hostSpaces.ofHost(hostId);
				const { rows: batch, cursors } = await exchange.rowsAfter({
					spaces,
					cursors: await exchange.cursorsWith(hostId),
					only: selfId,
					limit: 200,
				});
				if (isEmpty(batch)) {
					await landed;
					continue;
				}
				// A batch the Host refuses goes again, whole, after the link's backoff.
				await client.sync.push(batch, { signal });
				// The Host has the runs now: their ended nodes' files follow.
				await archive(client, batch, signal);
				await exchange.advance(hostId, cursors);
			} finally {
				cycle.abort();
			}
		}
	}

	/** Puts the files of the batch's ended nodes, and their runs' walk state, in the Host's archive. */
	async function archive(
		client: HostClient,
		batch: RunRows,
		signal: AbortSignal,
	) {
		for (const { ref, content, stamp } of await exchange.walkFilesOf(batch)) {
			// The stamp says which end of the step the copy holds.
			await client.archive.put(
				{ ref, content, ...(stamp ? { stamp } : {}) },
				{ signal },
			);
		}
	}

	/** One pull stream: rows and follows (and an older Host's Commands) until it ends or `signal` aborts. */
	async function pull(client: HostClient, signal: AbortSignal) {
		/** The commands whose result the Host has from this stream. */
		const reported = new Set<string>();
		// The live transcripts the Host wants of this computer's runs. A
		// stream that ends stops them: the next one says again what it wants.
		const pumps = exchange.feeds.pumps((step, entries, ended, stop) =>
			client.archive.tail(
				{ step, entries, ended },
				{ signal: AbortSignal.any([signal, stop]) },
			),
		);
		try {
			const stream = await client.sync.stream(
				// The Commands come on their own stream.
				{ cursors: await exchange.cursorsWith(hostId), commands: false },
				{ signal },
			);
			for await (const batch of stream) {
				// A Host of an older version sends no follows.
				pumps.set(batch.follows ?? []);
				if (!isEmpty(batch.rows)) {
					await ingestWhenReady(batch.rows, signal);
					await exchange.advance(hostId, batch.cursors);
				}
				// A Host of an older version sends its Commands here, after
				// the rows they need, and only when some wait.
				if (batch.commands.length > 0 || reported.size > 0) {
					await take(
						client,
						batch.commands,
						reported,
						batch.commands.length > 0,
						signal,
					);
				}
			}
		} finally {
			pumps.close();
		}
	}

	/** The Commands stream, apart from the rows. */
	async function commands(client: HostClient, signal: AbortSignal) {
		const reported = new Set<string>();
		let stream: AsyncIterable<{ commands: RunCommand[] }>;
		try {
			stream = await client.sync.commands({}, { signal });
		} catch (error) {
			if (!olderHost(error)) throw error;
			// Its Commands come with the rows. It may be updated meanwhile:
			// ask again in an hour.
			await pause(OLDER_HOST_WAIT_MS, signal);
			return;
		}
		for await (const batch of stream) {
			await take(client, batch.commands, reported, true, signal);
		}
	}

	/** Ingests a batch, waiting a while for a project its Space document still brings. */
	async function ingestWhenReady(batch: RunRows, signal: AbortSignal) {
		const deadline = Date.now() + (deps.projectWaitMs ?? 30_000);
		while (true) {
			try {
				await exchange.ingest(batch);
				return;
			} catch (error) {
				if (!(error instanceof MissingProjectError) || Date.now() > deadline) {
					throw error;
				}
				await pause(250, signal);
				if (signal.aborted) throw error;
			}
		}
	}

	return {
		attach(link) {
			const stops = [
				link.stream("sync.push", push),
				link.stream("sync.stream", pull),
				link.stream("sync.commands", commands),
			];
			return () => {
				for (const stop of stops) stop();
			};
		},
	};
}

/** How long the Commands stream waits before it asks a Host of an older version again. */
const OLDER_HOST_WAIT_MS = 60 * 60_000;

/** A Host of a version before `sync.commands`: it does not know the procedure. */
function olderHost(error: unknown): boolean {
	return (
		error instanceof ORPCError &&
		(error.code === "NOT_FOUND" || error.status === 404)
	);
}
