import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	lgCheckpoint,
	lgWrite,
	project,
	run,
	step,
} from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { eq } from "drizzle-orm";
import type { WalkRef } from "../../../../archive";
import { createRunWalks } from "../../../../graph";
import {
	createRunBus,
	createRunHistory,
	createRunLog,
	type LoggedEvent,
} from "../../../../log";
import { transcriptPath } from "../../../../log/transcript/transcripts";
import { ownDevice } from "../../../../testing/alone-directory";
import { appendEvent } from "../../../../testing/append-event";
import { localSpaceId } from "../../../../testing/test-support";
import { archiveWalkHandover } from "./archive-walk-handover";
import { inMemoryWalkHandover } from "./in-memory-walk-handover";
import { walkHandoverContract } from "./walk-handover.contract";

/**
 * The contract of `WalkHandover`, on both adapters. The real side runs on
 * libsql in memory with a data folder of its own: a migrated database with
 * one project, the run log and the run history of this computer, its walk
 * files, and a Space archive in memory (the peers' `RunsPort` keeps it in
 * a daemon).
 */

/** The step of each run of the suite. */
const STEP = "s1";

/** A transcript with entries of these seqs, as a step's file holds it. */
const transcriptOf = (seqs: readonly number[]) =>
	seqs.map((seq) => `${JSON.stringify({ seq, stepId: STEP })}\n`).join("");

walkHandoverContract("in memory", async () => {
	const here = "this-computer";
	const handover = inMemoryWalkHandover(here);
	let seq = 0;
	return {
		handover,
		here,
		async add(runId, seqs) {
			handover.walkState.set(runId, {
				checkpoint: `the checkpoint of ${runId}`,
				transcripts: { [STEP]: seqs },
			});
			return { id: runId, spaceId: "space-1" };
		},
		walkState: async (runId) => structuredClone(handover.walkState.get(runId)),
		async wipe(runId) {
			handover.walkState.delete(runId);
		},
		failNextKeep: () => handover.failNextKeep(),
		async logMove(runId, from, to) {
			return {
				seq: ++seq,
				runId,
				stepId: null,
				sessionId: null,
				type: "WalkerMoved",
				payload: { from, to, by: null },
				at: seq,
			} as LoggedEvent;
		},
		async logArrival(runId) {
			handover.arrived(runId);
		},
		walkerOf: async (runId) => handover.walkerOf(runId),
		close: async () => {},
	};
});

walkHandoverContract(
	"over the archive, the walk files and the run log, on libsql in memory",
	async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "walk-handover-"));
		const db = await migratedDb();
		const here = (await ownDevice(db)).id;
		const spaceId = await localSpaceId(db);
		await db
			.insert(project)
			.values({ id: "project-1", spaceId, name: "one", folder: false });
		const log = createRunLog(db, { walkerId: here, dataDir });
		const history = createRunHistory({
			db,
			dataDir,
			log,
			bus: createRunBus(),
		});
		const walks = createRunWalks({ db, log, history });
		const kept = new Map<string, string>();
		const keyOf = (ref: WalkRef) =>
			[
				ref.kind,
				ref.spaceId,
				ref.runId,
				"stepId" in ref ? ref.stepId : "",
			].join("/");
		let keepFails = false;
		return {
			handover: archiveWalkHandover({
				db,
				walkerId: () => log.walkerId(),
				archive: {
					async keepWalk(files) {
						if (keepFails) {
							keepFails = false;
							throw new Error("The Host cannot be reached.");
						}
						for (const f of files) kept.set(keyOf(f.ref), f.content);
					},
					archived: async (ref) => kept.get(keyOf(ref)) ?? null,
				},
				walks,
			}),
			here,
			async add(runId, seqs) {
				await db.insert(run).values({
					id: runId,
					spaceId,
					projectId: "project-1",
					flow: "{}",
					title: "t",
					worktreePath: "",
					branch: "",
					baseRef: "",
					walkerId: here,
				});
				const path = transcriptPath(dataDir, runId, STEP);
				await db.insert(step).values({
					id: STEP,
					spaceId,
					runId,
					nodeId: "a",
					nodeType: "agent",
					visit: 1,
					transcriptPath: path,
				});
				await mkdir(dirname(path), { recursive: true });
				await writeFile(path, transcriptOf(seqs));
				await db.insert(lgCheckpoint).values({
					threadId: runId,
					checkpointNs: "",
					checkpointId: "c1",
					type: "json",
					checkpoint: Buffer.from(`the checkpoint of ${runId}`),
					metadata: Buffer.from("{}"),
				});
				await db.insert(lgWrite).values({
					threadId: runId,
					checkpointNs: "",
					checkpointId: "c1",
					taskId: "t1",
					idx: 0,
					channel: "out",
					type: "json",
					value: Buffer.from("1"),
				});
				return { id: runId, spaceId };
			},
			async walkState(runId) {
				return (await walks.exportWalk(runId)).map(({ ref, content }) => ({
					ref,
					content,
				}));
			},
			async wipe(runId) {
				await db.delete(lgWrite).where(eq(lgWrite.threadId, runId));
				await db.delete(lgCheckpoint).where(eq(lgCheckpoint.threadId, runId));
				await rm(transcriptPath(dataDir, runId, STEP), { force: true });
			},
			failNextKeep() {
				keepFails = true;
			},
			logMove: (runId, from, to) =>
				appendEvent(
					db,
					{ runId, type: "WalkerMoved", payload: { from, to, by: null } },
					from,
				),
			async logArrival(runId, from) {
				await appendEvent(
					db,
					{ runId, type: "WalkerArrived", payload: { from } },
					here,
				);
			},
			async walkerOf(runId) {
				const [row] = await db
					.select({ walkerId: run.walkerId })
					.from(run)
					.where(eq(run.id, runId));
				return row?.walkerId ?? "";
			},
			async close() {
				await rm(dataDir, { recursive: true, force: true });
			},
		};
	},
);
