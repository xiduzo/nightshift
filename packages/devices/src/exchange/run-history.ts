import { roleAllows } from "@nightshift/auth";
import { syncCursor } from "@nightshift/db/schema";
import {
	type CopyStamp,
	type Engine,
	type LandedScope,
	type LoggedEvent,
	memberRole,
	type PeerContext,
	parseTranscript,
	type WalkFile,
	type WalkFiles,
} from "@nightshift/engine";
import { Refusal, wordsFor } from "@nightshift/refusal";
import { eq, sql } from "drizzle-orm";
import { dropArchive, readCopy, writeArchive } from "../archive";
import type { ArchiveRef, RunCommand, RunRows, SyncCursors } from "../contract";
import type { HostSpaces } from "../links";
import {
	applyRunCommand,
	COMMAND_PERMISSION,
	createRunCommands,
	type RunCommands,
} from "./commands";
import {
	createTranscriptFeeds,
	type FeedPorts,
	type TranscriptFeeds,
} from "./feeds";
import { createTakeOvers } from "./take-overs";

/** Why a Command waits: its run is not walked here yet. It comes again. */
const ON_ITS_WAY = "The run is still on its way to this device.";
/** Why a Command is not applied: its run moved on from this computer. */
const MOVED_ON = "The run moved to another device before this reached it.";
/** Why a Command is not applied: its run ended on another device. */
const ENDED_ELSEWHERE = "The run ended before this reached it.";
/** Why a Command is not applied: its run is of another Space here. */
const NOT_HERE = "This device does not run this run.";

/**
 * Events that do not wake the exchange. A session's spend so far lands
 * every few seconds while an agent works, more than half of all events,
 * and only its latest counts: it goes with the next event that wakes the
 * exchange, or at the next look when nothing else lands.
 */
const QUIET: ReadonlySet<string> = new Set(["SessionUsage"]);

/**
 * Run history between this Replica and its Hosts: the one module both
 * halves of the exchange go through, the Device's (`DeviceExchange`) and
 * the Host's (`HostExchange`), so both keep the same rules.
 *
 * - Rows go out by cursor, in the order their events landed here
 *   (`rowsAfter`): each Walker's in its own order, and a moved run's old
 *   Walker before its new one.
 * - A batch lands in one transaction (`ingest`, the engine's
 *   `RunHistory.ingest`). Everything that follows from it is read from
 *   the log, so a batch that comes again after a crash repeats it safely:
 *   the run's Walker and a session's harness id (in the transaction), a
 *   run that moved here taken over (tried again until it arrived, also
 *   after a restart), and the copy of a step reopened elsewhere dropped.
 * - A Command is applied once (`apply`): the first event it writes carries
 *   its id, so the log says what was applied, also after a restart. It
 *   waits for its run: rows that are still on their way, a take-over that
 *   has not arrived.
 * - This Replica's cursor with each Host (`sync_cursor`): "this Walker's
 *   events in this Space after `walker_seq` N".
 *
 * Beside it: the Commands a Host keeps for their Walkers (`commands`), the
 * live transcripts (`feeds`) and the Host's archive files (`archive`).
 */
export type RunHistoryExchange = {
	/**
	 * The run rows of `spaces` after `cursors`, in the order their events
	 * landed here: every Walker's but `except`, or only `only`'s. At most
	 * `limit` events. Returns the cursors moved past them.
	 */
	rowsAfter(input: {
		spaces: readonly string[];
		cursors: SyncCursors;
		only?: string;
		except?: string;
		limit?: number;
	}): Promise<{ rows: RunRows; cursors: SyncCursors }>;
	/**
	 * Adds a batch to this Replica in one transaction, then what follows
	 * from the log. Rows it has are skipped. With `walker`, every row must
	 * be that Walker's; with `spaces`, every row must be in one of them
	 * (`ForeignRowsError`). A run whose project is not here refuses it as
	 * not yet (`MissingProjectError`). Returns the events that were new.
	 */
	ingest(
		rows: RunRows,
		check?: { walker?: string; spaces?: readonly string[] },
	): Promise<LoggedEvent[]>;
	/** This Replica's cursors with a Host. */
	cursorsWith(hostId: string): Promise<SyncCursors>;
	/** Moves this Replica's cursors with a Host forward (never back). */
	advance(hostId: string, cursors: SyncCursors): Promise<void>;
	/**
	 * Resolves when a run event lands in this Replica (appended or
	 * ingested) of `scope`'s Spaces and Walkers, after `timeoutMs`, or when
	 * `signal` aborts: whichever comes first. A spend so far
	 * (`SessionUsage`) does not wake it: it goes with the next event that
	 * does, or after `timeoutMs`.
	 */
	landed(
		signal: AbortSignal,
		timeoutMs: number,
		scope?: LandedScope,
	): Promise<void>;
	/**
	 * Applies a Command for a run this computer walks, through `engine`,
	 * once. Returns why not, or null when it is applied: now, or before
	 * (its id is in the log). A run that moved on from here, or that ended
	 * elsewhere, is a reason. Throws at once while the run is still on its
	 * way here (`ON_ITS_WAY`: the rows that move it here, or its take-over,
	 * have not arrived): the Command waits, however long that takes, and
	 * comes again.
	 */
	apply(
		command: RunCommand,
		engine: Pick<Engine, "space">,
	): Promise<string | null>;
	/**
	 * What the Host's archive takes after a pushed batch: the files of its
	 * ended steps, and the walk state of their runs. Nothing of a run that
	 * moved on since: its new Walker sends its files.
	 */
	walkFilesOf(batch: RunRows): Promise<WalkFile[]>;
	/** A run's Walker and Space, or null for a run this Replica lacks. */
	runOwner(
		runId: string,
	): Promise<{ walkerId: string; spaceId: string } | null>;
	/** A step's run, Walker and Space, or null. */
	stepOwner(
		stepId: string,
	): Promise<{ runId: string; walkerId: string; spaceId: string } | null>;
	/** On a Host: the Commands it keeps for their Walkers. */
	commands: RunCommands;
	/** Live transcripts: one feed per step, wherever its run is walked. */
	feeds: TranscriptFeeds;
	/** The archive files on this Replica, as a Host keeps and serves them. */
	archive: {
		/**
		 * A file of the archive here: a copy of a step's file only when its
		 * stamp holds the step as this Replica's log says. Null otherwise.
		 */
		read(ref: ArchiveRef): Promise<string | null>;
		/** Keeps a file of the archive, with its stamp. A transcript tells the run's watchers. */
		write(ref: ArchiveRef, content: string, stamp?: CopyStamp): Promise<void>;
		/**
		 * A file of a run this Replica walks, for the archive's readers: a
		 * step's transcript or command log, or the run's Checkpoint. Null
		 * when it has none, or another Device walks the run.
		 */
		own: WalkFiles["ownFile"];
	};
	/** Stops the take-overs that wait to be tried again. */
	close(): void;
};

export function createRunHistoryExchange(deps: {
	/** The engine's own parts, as the peers get them. */
	context: Pick<
		PeerContext,
		| "db"
		| "dataDir"
		| "device"
		| "log"
		| "bus"
		| "history"
		| "walks"
		| "documents"
		| "ready"
		| "stepStamp"
		| "takeOver"
	>;
	/** The Spaces the Hosts keep. */
	hostSpaces: HostSpaces;
	/** The feed of the Host that keeps a Space (over its link). */
	upstream?: FeedPorts["upstream"];
	/**
	 * A file of the archive: this Replica's copy, else the Host's that
	 * keeps the Space (`RunsPort.archived`). Throws when that Host cannot
	 * be reached. Without it, only this Replica's copy is read.
	 */
	archived?(ref: ArchiveRef): Promise<string | null>;
}): RunHistoryExchange {
	const { context, hostSpaces } = deps;
	const { db, dataDir, log, bus, history, walks, documents } = context;
	const { runOwner } = history;

	/** This computer's ids: the runs it walks name one of them. */
	const here = async () => [await log.walkerId(), context.device.id];

	const takeOvers = createTakeOvers({
		ready: context.ready,
		arriving: async () => history.arriving(await here()),
		takeOver: (runId) => context.takeOver(runId),
	});

	const feeds = createTranscriptFeeds({
		bus,
		selfId: () => log.walkerId(),
		runOwner,
		hostOf: (spaceId) => hostSpaces.hostOf(spaceId),
		stepEnded: async (step) => (await context.stepStamp(step))?.ended === true,
		ownEntries: (at) => history.ownTranscript(at),
		// Asked only for a step that ended. A copy of another end is not
		// there yet: the feed reads the step instead, and again later. A
		// copy from the Host is kept here, with the end it holds.
		async archived(at) {
			const ref: ArchiveRef = { kind: "transcript", ...at };
			const known = await context.stepStamp(at);
			const local = await readCopy(dataDir, ref, known);
			if (local !== null) return parseTranscript(local);
			const fetched = await deps.archived?.(ref).catch(() => null);
			if (fetched === null || fetched === undefined) return null;
			// Not `archive.write` below: nothing about the step changed.
			if (known?.ended) await writeArchive(dataDir, ref, fetched, known);
			return parseTranscript(fetched);
		},
		...(deps.upstream ? { upstream: deps.upstream } : {}),
	});

	/**
	 * A step another Replica reopened: the copy of its transcript kept
	 * here from an earlier end is not whole any more. It goes, so the step
	 * is read again once it ends. In a Space this Replica keeps, the
	 * archive is the Walker's own copy, and the Walker puts it again. A
	 * copy this misses after a crash holds no step: its stamp is of the
	 * earlier end (`readCopy`).
	 */
	async function dropReopenedCopies(added: readonly LoggedEvent[]) {
		for (const e of added) {
			if (e.type !== "StepReopened" || !e.runId || !e.stepId) continue;
			const owner = await runOwner(e.runId);
			if (!owner || (await hostSpaces.hostOf(owner.spaceId)) === null) {
				continue;
			}
			await dropArchive(dataDir, {
				kind: "transcript",
				spaceId: owner.spaceId,
				runId: e.runId,
				stepId: e.stepId,
			});
		}
	}

	/**
	 * Where the run of a Command stands, as this Replica's log says:
	 * - `here`: this computer walks it.
	 * - `on-its-way`: not yet. A Command can come before the rows that move
	 *   its run here, and they can take long. So can a run this Replica
	 *   does not have yet: its Host names this computer as its Walker.
	 * - Any other answer is why the Command is not for this computer: the
	 *   run moved on from here (its latest move is from here), it ended
	 *   elsewhere (a finished run never moves), or it is of another Space.
	 */
	async function standing(
		runId: string,
		spaceId: string,
	): Promise<"here" | "on-its-way" | string> {
		const owner = await runOwner(runId);
		if (owner === null) return "on-its-way";
		if (owner.spaceId !== spaceId) return NOT_HERE;
		const ids = await here();
		if (ids.includes(owner.walkerId)) return "here";
		const events = await log.events(runId);
		const lastMove = events.findLast((e) => e.type === "WalkerMoved");
		if (
			lastMove?.type === "WalkerMoved" &&
			ids.includes(lastMove.payload.from)
		) {
			return MOVED_ON;
		}
		const last = events.at(-1);
		if (last?.type === "RunEnded" && last.payload.status === "finished") {
			return ENDED_ELSEWHERE;
		}
		return "on-its-way";
	}

	function landedWithin(
		timeoutMs: number,
		signal?: AbortSignal,
		scope?: LandedScope,
	) {
		return new Promise<void>((resolve) => {
			if (signal?.aborted) return resolve();
			const done = () => {
				clearTimeout(timer);
				off();
				signal?.removeEventListener("abort", done);
				resolve();
			};
			const timer = setTimeout(done, timeoutMs);
			const off = history.landed.subscribe((events) => {
				if (events.some((e) => !QUIET.has(e.type))) done();
			}, scope);
			signal?.addEventListener("abort", done, { once: true });
		});
	}

	return {
		async rowsAfter(input) {
			return history.rowsAfter(input);
		},

		async ingest(rows, check = {}) {
			const added = await history.ingest(rows, check);
			await dropReopenedCopies(added);
			// A run that moved here: this computer walks it from now on.
			if (added.some((e) => e.type === "WalkerMoved")) takeOvers.look();
			return added;
		},

		async cursorsWith(hostId) {
			const rows = await db
				.select()
				.from(syncCursor)
				.where(eq(syncCursor.hostId, hostId));
			const cursors: SyncCursors = {};
			for (const row of rows) {
				cursors[row.spaceId] = {
					...cursors[row.spaceId],
					[row.walkerId]: row.walkerSeq,
				};
			}
			return cursors;
		},

		async advance(hostId, cursors) {
			for (const [spaceId, walkers] of Object.entries(cursors)) {
				for (const [walkerId, walkerSeq] of Object.entries(walkers)) {
					await db
						.insert(syncCursor)
						.values({ hostId, spaceId, walkerId, walkerSeq })
						.onConflictDoUpdate({
							target: [
								syncCursor.hostId,
								syncCursor.spaceId,
								syncCursor.walkerId,
							],
							set: {
								walkerSeq: sql`max(${syncCursor.walkerSeq}, excluded.walker_seq)`,
								updatedAt: sql`(cast(unixepoch('subsecond') * 1000 as integer))`,
							},
						});
				}
			}
		},

		landed: (signal, timeoutMs, scope) =>
			landedWithin(timeoutMs, signal, scope),

		async apply(command, engine) {
			// Its id in the log: applied here before, also before a restart.
			if (await history.applied(command)) return null;
			const stands = await standing(command.runId, command.spaceId);
			if (stands === "on-its-way") throw new Refusal("conflict", ON_ITS_WAY);
			if (stands !== "here") return stands;
			// A run that moved here takes its walk state first.
			if (!(await takeOvers.arrived(command.runId))) {
				throw new Refusal("conflict", ON_ITS_WAY);
			}
			const role = memberRole(
				await documents.open(command.spaceId),
				command.personId,
			);
			if (!role || !roleAllows(role, COMMAND_PERMISSION[command.kind])) {
				return "The person who asked may not do this in this Space.";
			}
			try {
				await history.applying(command, () =>
					applyRunCommand(
						engine.space(command.spaceId, { personId: command.personId }),
						command,
					),
				);
				return null;
			} catch (error) {
				// The words go to the person who asked. A failure's details stay in this log.
				if (!(error instanceof Refusal)) {
					console.error(
						`[devices] command ${command.kind} on run ${command.runId} failed:`,
						error,
					);
				}
				return wordsFor(error);
			}
		},

		async walkFilesOf(batch) {
			/** The ended steps of each run with an ended step or end. */
			const ended = new Map<string, string[]>();
			for (const e of batch.events) {
				const stepId = e.type === "StepEnded" ? e.stepId : null;
				if (!stepId && e.type !== "RunEnded") continue;
				const steps = ended.get(e.runId) ?? [];
				if (stepId) steps.push(stepId);
				ended.set(e.runId, steps);
			}
			const files: WalkFile[] = [];
			for (const [runId, steps] of ended) {
				// Empty for a run that has moved since.
				files.push(...(await walks.exportWalk(runId, { steps })));
			}
			return files;
		},

		runOwner,
		stepOwner: history.stepOwner,
		commands: createRunCommands({ db }),
		feeds,
		archive: {
			async read(ref) {
				const known =
					ref.kind === "checkpoint" ? null : await context.stepStamp(ref);
				return readCopy(dataDir, ref, known);
			},
			async write(ref, content, stamp) {
				await writeArchive(dataDir, ref, content, stamp);
				// A watcher of the run reads the step's transcript again.
				if (ref.kind === "transcript") {
					bus.publish(ref.runId, { kind: "step-changed", stepId: ref.stepId });
				}
			},
			own: walks.ownFile,
		},
		close: () => takeOvers.close(),
	};
}
