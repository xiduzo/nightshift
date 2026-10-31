import { createHash } from "node:crypto";
import { documentName, type Engine } from "@nightshift/engine";
import type { HostClient, RunCommand, RunRows } from "../contract";
import { type HostSpaces, isOlderHost, type Link, pause } from "../links";
import { isEmpty, MissingProjectError, mergeCursors } from "./rows";
import type { RunHistoryExchange } from "./run-history";

/**
 * This Device's half of the exchange of run history with one Host (the
 * Host's half is `HostExchange`; both go through `RunHistoryExchange`).
 * One per Host and engine. It runs as three streams of its Link
 * (`attach`), all outbound. The Link starts them when it is online, stops
 * them when it drops, and starts them again after a failure:
 *
 * - Push: the rows this computer walked in the Spaces the Host keeps,
 *   after the Host's cursor, whenever one of them lands here (`sync.push`;
 *   a spend so far waits for the next, `RunHistoryExchange.landed`).
 *   After a batch with a node that ended, that step's transcript and
 *   command log, and its run's walk state when it changed, go to the
 *   Host's archive (the Host takes files of runs it has). The cursor moves when both are
 *   done: a batch that fails halfway goes again, whole.
 * - Pull: `sync.stream` from this Replica's cursors: other Walkers' rows
 *   as they land on the Host, each batch in one transaction. A batch whose
 *   project has not arrived yet (its Space document is on its way) waits
 *   for it, then the stream starts again from the same cursor. The stream
 *   also says which steps of this computer's runs someone follows: their
 *   live transcripts go to the Host (`archive.tail`) while they are
 *   wanted.
 * - Commands: `sync.commands`, the Commands for the runs this computer
 *   walks, on their own stream, so they never wait behind rows, nor
 *   behind a run that is still on its way here. Such a run's Commands
 *   wait until it arrived, however long that takes, and go as soon as a
 *   row lands here. A Host of an older version has none: its Commands
 *   come with the rows, and this stream waits until the link drops.
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
	attach(link: Pick<Link, "stream" | "inStep">): () => void;
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
	/**
	 * How long a loop waits for a new row before it looks again: the push,
	 * and the Commands of a run still on its way here. Default 15 s.
	 */
	idleMs?: number;
	/** The most rows in one pushed batch. Default 200. */
	batchRows?: number;
}): DeviceExchange {
	const { engine, hostId, selfId } = deps;
	const { exchange } = engine;
	const applied: AppliedCommands = deps.applied ?? new Map();

	/** The command's result: applied here once, by whichever stream takes it first. */
	function applyOnce(command: RunCommand): Promise<string | null> {
		const known = applied.get(command.id);
		if (known) return known;
		const result = exchange.apply(command, engine);
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
	 *
	 * A Command this computer cannot tell about yet (its run is still on
	 * its way here) waits, with the later Commands of its run, so their
	 * order holds. The others go on. Returns why the first of those waits,
	 * or null when none does: the caller takes them again later.
	 */
	async function take(
		client: HostClient,
		commands: readonly RunCommand[],
		reported: Set<string>,
		whole: boolean,
		signal: AbortSignal,
	): Promise<{ why: unknown } | null> {
		/** The runs whose Commands wait, and why the first one does. */
		const waiting = new Map<string, unknown>();
		for (const command of commands) {
			if (reported.has(command.id) || waiting.has(command.runId)) continue;
			let error: string | null;
			try {
				error = await applyOnce(command);
			} catch (notYet) {
				waiting.set(command.runId, notYet);
				continue;
			}
			await client.sync.commandDone({ id: command.id, error }, { signal });
			reported.add(command.id);
		}
		const pending = new Set(commands.map((c) => c.id));
		for (const id of reported) {
			if (!pending.has(id)) reported.delete(id);
		}
		if (whole) {
			for (const id of applied.keys()) {
				if (!pending.has(id)) applied.delete(id);
			}
		}
		const [first] = waiting.values();
		return waiting.size > 0 ? { why: first } : null;
	}

	/**
	 * Sends this computer's rows, a batch at a time, until `signal` aborts.
	 * Throws when a batch fails. It wakes for this computer's own events
	 * in the Host's Spaces only: the rows it pulls are not its to send.
	 */
	async function push(client: HostClient, signal: AbortSignal) {
		// The cursor of this computer's own rows moves only here.
		let at = await exchange.cursorsWith(hostId);
		while (!signal.aborted) {
			const spaces = await engine.hostSpaces.ofHost(hostId);
			const cycle = new AbortController();
			// Listen before reading, so nothing lands unseen between the two.
			const landed = exchange.landed(
				AbortSignal.any([signal, cycle.signal]),
				deps.idleMs ?? 15_000,
				{ spaces, only: selfId },
			);
			try {
				const { rows: batch, cursors } = await exchange.rowsAfter({
					spaces,
					cursors: at,
					only: selfId,
					limit: deps.batchRows ?? 200,
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
				at = mergeCursors(at, cursors);
			} finally {
				cycle.abort();
			}
		}
	}

	/**
	 * The walk state each run last put in the Host's archive, by a hash of
	 * it. Steps that end in one superstep (the items of a For Each), and a
	 * run's end after its last step, leave it as it was: it goes once.
	 */
	const putCheckpoints = new Map<string, string>();

	/** Puts the files of the batch's ended nodes, and their runs' walk state, in the Host's archive. */
	async function archive(
		client: HostClient,
		batch: RunRows,
		signal: AbortSignal,
	) {
		for (const { ref, content, stamp } of await exchange.walkFilesOf(batch)) {
			const hash =
				ref.kind === "checkpoint"
					? createHash("sha256").update(content).digest("base64")
					: null;
			if (hash !== null && putCheckpoints.get(ref.runId) === hash) continue;
			// The stamp says which end of the step the copy holds.
			await client.archive.put(
				{ ref, content, ...(stamp ? { stamp } : {}) },
				{ signal },
			);
			if (hash !== null) putCheckpoints.set(ref.runId, hash);
		}
		// An ended run's walk state changes no more.
		for (const event of batch.events) {
			if (event.type === "RunEnded") putCheckpoints.delete(event.runId);
		}
	}

	/** One pull stream: rows and follows (and an older Host's Commands) until it ends or `signal` aborts. */
	async function pull(
		link: Pick<Link, "inStep">,
		client: HostClient,
		signal: AbortSignal,
	) {
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
					await ingestWhenReady(batch.rows, link, signal);
					await exchange.advance(hostId, batch.cursors);
				}
				// A Host of an older version sends its Commands here, after
				// the rows they need, and only when some wait. One whose run
				// is still on its way starts the stream again: the Host sends
				// it again.
				if (batch.commands.length > 0 || reported.size > 0) {
					const waits = await take(
						client,
						batch.commands,
						reported,
						batch.commands.length > 0,
						signal,
					);
					if (waits) throw waits.why;
				}
			}
		} finally {
			pumps.close();
		}
	}

	/**
	 * The Commands stream, apart from the rows. A Command whose run is
	 * still on its way here waits on this stream, however long the run
	 * takes: the stream takes the Commands again when a row lands here (the
	 * rows that move the run here, its take-over), when the Host sends a
	 * new set, and after `idleMs`.
	 */
	async function commands(client: HostClient, signal: AbortSignal) {
		const reported = new Set<string>();
		let stream: AsyncIterable<{ commands: RunCommand[] }>;
		try {
			stream = await client.sync.commands({}, { signal });
		} catch (error) {
			if (!isOlderHost(error)) throw error;
			// Its Commands come with the rows. It may be updated meanwhile:
			// ask again in an hour.
			await pause(OLDER_HOST_WAIT_MS, signal);
			return;
		}
		const batches = stream[Symbol.asyncIterator]();
		let latest: RunCommand[] = [];
		/** The Host's next set, asked for once the last one was taken. */
		let next: Promise<IteratorResult<{ commands: RunCommand[] }>> | null = null;
		let waits = false;
		try {
			while (!signal.aborted) {
				if (!next) {
					next = batches.next();
					// A race may leave it for a later turn, or the stream may end
					// first: its failure is read there, or not at all.
					next.catch(() => {});
				}
				const cycle = new AbortController();
				const landed = waits
					? exchange
							.landed(
								AbortSignal.any([signal, cycle.signal]),
								deps.idleMs ?? 15_000,
							)
							.then(() => null)
					: null;
				try {
					const got = await (landed ? Promise.race([next, landed]) : next);
					if (got !== null) {
						if (got.done) return;
						latest = got.value.commands;
						next = null;
					}
				} finally {
					cycle.abort();
				}
				if (signal.aborted) return;
				waits = (await take(client, latest, reported, true, signal)) !== null;
			}
		} finally {
			void Promise.resolve(batches.return?.()).catch(() => {});
		}
	}

	/**
	 * Ingests a batch. A run whose project is not here yet waits for the
	 * Space documents that bring it to be in step with the Host, a while
	 * at most, and then is tried once more: else the stream starts again,
	 * from the same cursor.
	 */
	async function ingestWhenReady(
		batch: RunRows,
		link: Pick<Link, "inStep">,
		signal: AbortSignal,
	) {
		try {
			await exchange.ingest(batch);
		} catch (error) {
			if (!(error instanceof MissingProjectError)) throw error;
			const spaces = [...new Set(batch.runs.map((run) => run.spaceId))];
			const inStep = await link.inStep(
				spaces.map((id) => documentName("space", id)),
				{
					timeoutMs: deps.projectWaitMs ?? 30_000,
					signal,
				},
			);
			if (!inStep) throw error;
			await exchange.ingest(batch);
		}
	}

	return {
		attach(link) {
			const stops = [
				link.stream("sync.push", push),
				link.stream("sync.stream", (client, signal) =>
					pull(link, client, signal),
				),
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
