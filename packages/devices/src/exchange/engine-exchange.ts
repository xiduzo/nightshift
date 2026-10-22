import type { Database } from "@nightshift/db";
import {
	type CopyStamp,
	type FeedStep,
	type LoggedEvent,
	memberName,
	memberRole,
	parseTranscript,
	type RunBus,
	type RunHistory,
	type RunLog,
	recordClone,
	type SpaceDocuments,
	type WalkFiles,
} from "@nightshift/engine";
import { dropArchive, readCopy, writeArchive } from "../archive";
import type { ArchiveRef } from "../contract";
import { createHostSpaces, type HostSpaces } from "../links";
import { createRunCommands, type RunCommands } from "./commands";
import {
	createTranscriptFeeds,
	type FeedPorts,
	type TranscriptFeeds,
} from "./feeds";
import { createExchange, type Exchange } from "./rows";

/**
 * The engine's half of the exchange, for the daemon: on a Host it serves
 * rows, keeps commands and the archive; on a Device it pushes, pulls and
 * applies. The transport (oRPC over the Link) and the checks of who may
 * do what (membership, roles) are the daemon's.
 */
export type EngineExchange = {
	rows: Exchange;
	commands: RunCommands;
	hostSpaces: HostSpaces;
	/** Live transcripts: one feed per step, wherever its run is walked. */
	feeds: TranscriptFeeds;
	/** A run's Walker and Space, or null for a run this Replica lacks. */
	runOwner(
		runId: string,
	): Promise<{ walkerId: string; spaceId: string } | null>;
	/** A step's run, Walker and Space, or null. */
	stepOwner(
		stepId: string,
	): Promise<{ runId: string; walkerId: string; spaceId: string } | null>;
	/** The walk state of a run this Replica walks, as the archive keeps it (`WalkFiles.exportWalk`). Empty for anyone else's. */
	exportWalk: WalkFiles["exportWalk"];
	/**
	 * A file of the archive here: a copy of a step's file only when its
	 * stamp holds the step as this Replica's log says. Null otherwise.
	 */
	readArchive(ref: ArchiveRef): Promise<string | null>;
	/** Keeps a file of the archive, with its stamp. A transcript tells the run's watchers. */
	writeArchive(
		ref: ArchiveRef,
		content: string,
		stamp?: CopyStamp,
	): Promise<void>;
	/**
	 * A file of a run this Replica walks, for the archive's readers: a
	 * step's transcript or command log, or the run's Checkpoint. Null when
	 * it has none, or another Device walks the run.
	 */
	ownFile(ref: ArchiveRef): Promise<string | null>;
	/** Records a Device's Clone of a Project in a Space this Replica keeps (its Host's part). */
	recordClone(input: {
		spaceId: string;
		projectId: string;
		deviceId: string;
		deviceName: string;
	}): Promise<void>;
	/** A Person's role in a Space, as the Space document mirrors its Members. */
	memberRole(spaceId: string, personId: string): Promise<string | null>;
	/** A Member's name, as the Space document mirrors it (a Person this Replica has no account of). */
	memberName(spaceId: string, personId: string): Promise<string | null>;
};

export function createEngineExchange(deps: {
	db: Database;
	log: RunLog;
	bus: RunBus;
	/** The engine's run history: the rows the exchange copies. */
	history: RunHistory;
	/** The engine's walk state of own runs: the files the archive keeps. */
	walks: WalkFiles;
	dataDir: string;
	documents: SpaceDocuments;
	/** The events a batch added: a run moved here is taken over. */
	onIngested?(added: readonly LoggedEvent[]): Promise<void>;
	/** A step as this Replica's log says (`PeerContext.stepStamp`): which copy of its files holds it. */
	stepStamp(step: FeedStep): Promise<CopyStamp | null>;
	/** The feed of the Host that keeps a Space (over its link). */
	upstream?: FeedPorts["upstream"];
	/**
	 * A file of the archive: this Replica's copy, else the Host's that
	 * keeps the Space (`RunsPort.archived`). Throws when that Host cannot
	 * be reached. Without it, only this Replica's copy is read.
	 */
	archived?(ref: ArchiveRef): Promise<string | null>;
}): EngineExchange {
	const { db, log, history, walks, dataDir, documents } = deps;
	const { runOwner } = history;

	const hostSpaces = createHostSpaces(db);

	/** This Replica's copy of a file, when it holds the step as this Replica's log says. */
	async function ownCopy(ref: ArchiveRef): Promise<string | null> {
		const known = ref.kind === "checkpoint" ? null : await deps.stepStamp(ref);
		return readCopy(dataDir, ref, known);
	}

	const feeds = createTranscriptFeeds({
		bus: deps.bus,
		selfId: () => log.walkerId(),
		runOwner,
		hostOf: (spaceId) => hostSpaces.hostOf(spaceId),
		stepEnded: async (step) => (await deps.stepStamp(step))?.ended === true,
		ownEntries: (at) => history.ownTranscript(at),
		// Asked only for a step that ended. A copy of another end is not
		// there yet: the feed reads the step instead, and again later. A
		// copy from the Host is kept here, with the end it holds.
		async archived(at) {
			const ref: ArchiveRef = { kind: "transcript", ...at };
			const known = await deps.stepStamp(at);
			const local = await readCopy(dataDir, ref, known);
			if (local !== null) return parseTranscript(local);
			const fetched = await deps.archived?.(ref).catch(() => null);
			if (fetched === null || fetched === undefined) return null;
			// Not `writeArchive` below: nothing about the step changed.
			if (known?.ended) await writeArchive(dataDir, ref, fetched, known);
			return parseTranscript(fetched);
		},
		...(deps.upstream ? { upstream: deps.upstream } : {}),
	});

	/**
	 * A step another Replica reopened: the copy of its transcript kept
	 * here from an earlier end is not whole any more. It goes, so the step
	 * is read again once it ends. In a Space this Replica keeps, the
	 * archive is the Walker's own copy, and the Walker puts it again.
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

	return {
		rows: withIngested(createExchange(deps), async (added) => {
			await dropReopenedCopies(added);
			await deps.onIngested?.(added);
		}),
		commands: createRunCommands({ db }),
		hostSpaces,
		feeds,
		runOwner,
		stepOwner: history.stepOwner,
		exportWalk: walks.exportWalk,
		readArchive: ownCopy,
		async writeArchive(ref, content, stamp) {
			await writeArchive(dataDir, ref, content, stamp);
			// A watcher of the run reads the step's transcript again.
			if (ref.kind === "transcript") {
				deps.bus.publish(ref.runId, {
					kind: "step-changed",
					stepId: ref.stepId,
				});
			}
		},
		ownFile: walks.ownFile,
		async recordClone(input) {
			const document = await documents.open(input.spaceId);
			if (document.hostedElsewhere || !document.projects.has(input.projectId)) {
				throw new Error(`Project not found: ${input.projectId}`);
			}
			await document.change(() => recordClone(document, input));
		},
		async memberRole(spaceId, personId) {
			return memberRole(await documents.open(spaceId), personId);
		},
		async memberName(spaceId, personId) {
			return memberName(await documents.open(spaceId), personId);
		},
	};
}

/** The exchange, with a hook on the events each ingested batch added. */
function withIngested(
	exchange: Exchange,
	onIngested: (added: readonly LoggedEvent[]) => Promise<void>,
): Exchange {
	return {
		...exchange,
		async ingest(rows, check) {
			const added = await exchange.ingest(rows, check);
			await onIngested(added);
			return added;
		},
	};
}
