import type { Database } from "@nightshift/db";
import { run, step } from "@nightshift/db/schema/nightshift";
import { eq } from "drizzle-orm";

import type { RunBus } from "../bus";
import { deriveSteps, type LoggedEvent } from "../events";
import type { RunLog } from "../run-log";
import {
	memberRole,
	recordClone,
	type SpaceDocuments,
} from "../space/document";
import { parseTranscript, readTranscriptFile } from "../transcripts";
import {
	type ArchiveRef,
	checkpointSnapshot,
	ownStepFiles,
	readArchive,
	writeArchive,
} from "./archive";
import { createRunCommands, type RunCommands } from "./commands";
import {
	createTranscriptFeeds,
	type FeedPorts,
	type TranscriptFeeds,
} from "./feeds";
import { createHostSpaces, type HostSpaces } from "./host-spaces";
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
	/** A step this Replica walked, as the files the archive keeps. Null for anyone else's. */
	stepFiles(stepId: string): ReturnType<typeof ownStepFiles>;
	/** The run's latest checkpoints, as the archive keeps them. */
	checkpoint(runId: string): Promise<string>;
	readArchive(ref: ArchiveRef): Promise<string | null>;
	/** Keeps a file of the archive. A transcript tells the run's watchers. */
	writeArchive(ref: ArchiveRef, content: string): Promise<void>;
	/**
	 * A file of a run this Replica walked, for the archive's readers: its
	 * transcript or command log from disk, or its checkpoints. Null when
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
	dataDir: string;
	documents: SpaceDocuments;
	/** The events a batch added: a run moved here is taken over. */
	onIngested?(added: readonly LoggedEvent[]): Promise<void>;
	/** The feed of the Host that keeps a Space (over its link). */
	upstream?: FeedPorts["upstream"];
}): EngineExchange {
	const { db, log, dataDir, documents } = deps;

	async function runOwner(runId: string) {
		const [row] = await db
			.select({ walkerId: run.walkerId, spaceId: run.spaceId })
			.from(run)
			.where(eq(run.id, runId));
		return row ?? null;
	}

	const hostSpaces = createHostSpaces(db);

	const feeds = createTranscriptFeeds({
		bus: deps.bus,
		selfId: () => log.walkerId(),
		runOwner,
		hostOf: (spaceId) => hostSpaces.hostOf(spaceId),
		async stepEnded({ runId, stepId }) {
			const found = deriveSteps(await log.events(runId)).find(
				(s) => s.id === stepId,
			);
			return found !== undefined && found.endedAt !== null;
		},
		async ownEntries({ runId, stepId }) {
			const [row] = await db
				.select({ runId: step.runId, transcriptPath: step.transcriptPath })
				.from(step)
				.where(eq(step.id, stepId));
			if (!row || row.runId !== runId || !row.transcriptPath) return [];
			return readTranscriptFile(row.transcriptPath);
		},
		async archived(at) {
			const text = await readArchive(dataDir, { kind: "transcript", ...at });
			return text === null ? null : parseTranscript(text);
		},
		...(deps.upstream ? { upstream: deps.upstream } : {}),
	});

	return {
		rows: withIngested(createExchange(deps), deps.onIngested),
		commands: createRunCommands({ db }),
		hostSpaces,
		feeds,
		runOwner,
		async stepOwner(stepId) {
			const [row] = await db
				.select({
					runId: step.runId,
					walkerId: run.walkerId,
					spaceId: step.spaceId,
				})
				.from(step)
				.innerJoin(run, eq(run.id, step.runId))
				.where(eq(step.id, stepId));
			return row ?? null;
		},
		async stepFiles(stepId) {
			return ownStepFiles(db, dataDir, stepId, await log.walkerId());
		},
		checkpoint: (runId) => checkpointSnapshot(db, runId),
		readArchive: (ref) => readArchive(dataDir, ref),
		async writeArchive(ref, content) {
			await writeArchive(dataDir, ref, content);
			// A watcher of the run reads the step's transcript again.
			if (ref.kind === "transcript") {
				deps.bus.publish(ref.runId, {
					kind: "step-changed",
					stepId: ref.stepId,
				});
			}
		},
		async ownFile(ref) {
			const owner = await runOwner(ref.runId);
			if (!owner || owner.walkerId !== (await log.walkerId())) return null;
			if (ref.kind === "checkpoint") return checkpointSnapshot(db, ref.runId);
			const files = await ownStepFiles(
				db,
				dataDir,
				ref.stepId,
				await log.walkerId(),
			);
			if (!files || files.runId !== ref.runId) return null;
			return ref.kind === "log" ? files.log : files.transcript;
		},
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
			const entry = (await documents.open(spaceId)).members.get(personId) as
				| { name?: unknown }
				| undefined;
			return typeof entry?.name === "string" ? entry.name : null;
		},
	};
}

/** The exchange, with a hook on the events each ingested batch added. */
function withIngested(
	exchange: Exchange,
	onIngested?: (added: readonly LoggedEvent[]) => Promise<void>,
): Exchange {
	if (!onIngested) return exchange;
	return {
		...exchange,
		async ingest(rows, check) {
			const added = await exchange.ingest(rows, check);
			await onIngested(added);
			return added;
		},
	};
}
