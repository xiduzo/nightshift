import { randomUUID } from "node:crypto";
import { personalSpaceId, splitPersonalSpaceBatch } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { hostSpace, run } from "@nightshift/db/schema";
import {
	type Engine,
	type SpaceDocuments,
	spaceMoveBatch,
	spaceProjectRows,
	spaceRunIds,
} from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SplitResult, SplitState } from "../contract";
import type { HostLinks, HostSpaces } from "../links";
import { backupDatabase } from "./backup";
import { mergeRows } from "./merge-rows";
import { type MergeMove, NOT_DONE } from "./personal-merge";
import { type SplitRow, splitRows } from "./split-rows";

/**
 * The split of a personal Space off the one this computer's home Host
 * keeps, when this computer leaves that Host (ADR 1: leaving keeps a
 * copy): its Host removed its access, or the person ran `nightshift
 * leave`. The Person gets a personal Space of this computer's own again,
 * named "Personal", with the Projects this computer has a Clone of (or
 * walked a run of), their flows with their history, their schedules and
 * kept variables, and the runs this computer walked. The Host keeps
 * everything: it loses nothing.
 *
 * The Projects keep their ids, so their flow documents stay as they are
 * here, with their history; they no longer sync with the Host. The rows
 * that come along name the Person by their id here again. The Host's
 * Space stays on this computer with the rest of its rows, named
 * "Personal on <Host>", but the Person is no longer a Member of it here:
 * it is gone from the Space switcher.
 *
 * It rewrites this computer's database, so it goes in states that a
 * crash cannot leave half done (`space_split`, a sibling of
 * `space_merge`: a split has its own states and a new Space as its key):
 *
 * 1. Checks: the Person's personal Space is one a Host keeps, and this
 *    computer has no link with access to that Host (it left, or its
 *    access was removed). No run this computer walks there is not done.
 *    One split at a time in this process.
 * 2. `planned`: a copy of the whole database in the data directory
 *    (`VACUUM INTO`), before any change.
 * 3. `moved`: one `db.batch` makes the new Space the Person's personal
 *    Space (`splitPersonalSpaceBatch`), moves the rows (`spaceMoveBatch`
 *    with this computer's runs only), names the Host's Space "Personal
 *    on <Host>", adds what the composition root moves of the same runs
 *    (`moveStatements`), ends a merge that is not done, and sets this
 *    state. Then the engine reads the moved runs again.
 * 4. `done`: the new Space's document takes its Projects and Clones from
 *    the rows, as a new document does on its first open.
 *
 * A split that stopped goes on from its state, by itself
 * (`keepFinishing`).
 */
export type PersonalSpaceSplit = ReturnType<typeof createPersonalSplit>;

export const SPLIT_WORDS = {
	busy: "Night Shift splits your Personal off already. Wait until it is done.",
	notDone: (count: number) =>
		count === 1
			? "A run on this computer is not done yet. Let it finish or stop it, then leave."
			: `${count} runs on this computer are not done yet. Let them finish or stop them, then leave.`,
} as const;

export type PersonalSplitDeps = {
	db: Database;
	engine: Pick<Engine, "space" | "reindex"> & {
		hostSpaces: Pick<HostSpaces, "hostOf">;
	};
	hostLinks: Pick<HostLinks, "get">;
	spaces: Pick<SpaceDocuments, "open">;
	/** This computer's Device. */
	self: { id: string };
	/** The Person who owns this computer. */
	ownerId: string;
	dataDir: string;
	/** What the composition root moves of the same runs, in the same batch. */
	moveStatements?(moves: readonly MergeMove[]): BatchItem<"sqlite">[];
	now?: () => number;
};

/** The personal Space a Host keeps that this computer left, and who the Person is there. */
type Left = {
	from: string;
	hostId: string;
	hostName: string;
	hostPersonId: string;
};

export function createPersonalSplit(deps: PersonalSplitDeps) {
	const { db, engine, self } = deps;
	const now = deps.now ?? Date.now;
	const rows = splitRows(db);
	const merges = mergeRows(db);
	/** The split under way in this process: one at a time. */
	let running: Promise<unknown> | null = null;

	async function locked<T>(work: () => Promise<T>): Promise<T> {
		if (running) throw new Refusal("conflict", SPLIT_WORDS.busy);
		const task = work();
		running = task;
		try {
			return await task;
		} finally {
			running = null;
		}
	}

	/**
	 * The Person's personal Space when a Host keeps it and this computer
	 * has no link with access to that Host. Null when it is this
	 * computer's own, or the Host still has this computer.
	 */
	async function left(): Promise<Left | null> {
		const from = await personalSpaceId(db, deps.ownerId);
		if (from === null) return null;
		const hostId = await engine.hostSpaces.hostOf(from);
		if (hostId === null) return null;
		const link = await deps.hostLinks.get(hostId);
		if (link && link.revokedAt === null) return null;
		// A link that a new home Host replaced is gone: the merge says who the Person was there.
		const merged = await merges.latest();
		const mergedAs =
			merged?.toSpace === from ? merged.personMap[deps.ownerId] : undefined;
		return {
			from,
			hostId,
			hostName: link?.name ?? "your old Host",
			hostPersonId: link?.personId ?? mergedAs ?? deps.ownerId,
		};
	}

	/** Refuses while a run this computer walks in the Space is not done. */
	async function noRunsNotDone(spaceId: string): Promise<void> {
		const runs = await engine
			.space(spaceId)
			.listRuns({ statuses: [...NOT_DONE] });
		const here = runs.filter((r) => r.walker.id === self.id).length;
		if (here > 0) throw new Refusal("conflict", SPLIT_WORDS.notDone(here));
	}

	/** The Projects that come along: a Clone here, or a run this computer walked. */
	async function projectsHere(from: string): Promise<string[]> {
		const walked = new Set(
			(
				await db
					.selectDistinct({ projectId: run.projectId })
					.from(run)
					.where(and(eq(run.spaceId, from), eq(run.walkerId, self.id)))
			).map((r) => r.projectId),
		);
		return (await spaceProjectRows(db, from, self.id))
			.filter((p) => p.clone || walked.has(p.id))
			.map((p) => p.id);
	}

	/** Goes on from the split's state, to its end. */
	async function resume(row: SplitRow): Promise<SplitResult> {
		const { fromSpace: from, toSpace: to } = row;
		let state: SplitState = row.state;
		let projects = row.projects;
		let runs = row.runs;

		if (state === "planned") {
			await noRunsNotDone(from);
			projects = await projectsHere(from);
			const runIds = await spaceRunIds(db, from, projects, self.id);
			runs = runIds.length;
			const fromName = `Personal on ${row.hostName}`;
			const statements: BatchItem<"sqlite">[] = [
				...(await splitPersonalSpaceBatch(db, {
					personId: row.personId,
					from,
					to,
					fromName,
				})),
			];
			if (projects.length > 0) {
				statements.push(
					...(await spaceMoveBatch(db, {
						from,
						to,
						projectMap: Object.fromEntries(projects.map((id) => [id, id])),
						personMap: { [row.hostPersonId]: row.personId },
						runsOf: self.id,
					})),
				);
			}
			statements.push(
				db
					.update(hostSpace)
					.set({ name: fromName, updatedAt: new Date() })
					.where(eq(hostSpace.spaceId, from)),
				...(deps.moveStatements?.([{ from, to, runIds }]) ?? []),
				merges.abandon(),
				rows.moved(to, { projects, runs }),
			);
			await db.batch(
				statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
			);
			engine.reindex(runIds);
			state = "moved";
		}

		if (state === "moved") {
			// Its first open takes the Projects and Clones from the rows.
			await deps.spaces.open(to);
			await rows.done(to);
			state = "done";
		}
		return {
			state,
			spaceId: to,
			projects: projects.length,
			runs,
			backup: row.backup,
		};
	}

	/** Splits Personal off when this computer left its Host, or goes on with a split that stopped. */
	async function split(): Promise<SplitResult | null> {
		const started = await rows.unfinished();
		if (started) return resume(started);
		const leaving = await left();
		if (!leaving) {
			// A merge that never moved a row cannot go on without its Host.
			const merge = await merges.unfinished();
			if (merge && !(await linkedTo(merge.hostId))) {
				await db.batch([merges.abandon()]);
			}
			return null;
		}
		await noRunsNotDone(leaving.from);
		const backup = await backupDatabase(
			db,
			deps.dataDir,
			now(),
			"leaving-host",
		);
		const row = await rows.plan({
			toSpace: randomUUID(),
			fromSpace: leaving.from,
			hostId: leaving.hostId,
			hostName: leaving.hostName,
			personId: deps.ownerId,
			hostPersonId: leaving.hostPersonId,
			backup,
		});
		return resume(row);
	}

	async function linkedTo(hostId: string): Promise<boolean> {
		const link = await deps.hostLinks.get(hostId);
		return link !== null && link.revokedAt === null;
	}

	return {
		/**
		 * Splits Personal off the Space of the Host this computer left, or
		 * goes on with a split that stopped. Null: nothing to split, because
		 * Personal is this computer's own. Refuses while a run this computer
		 * walks there is not done: it waits for the person.
		 */
		run(): Promise<SplitResult | null> {
			return locked(split);
		},

		/**
		 * Refuses when this computer cannot leave its home Host now: a run
		 * it walks in Personal is not done. Changes nothing.
		 */
		async check(): Promise<void> {
			const from = await personalSpaceId(db, deps.ownerId);
			if (from !== null && (await engine.hostSpaces.hostOf(from)) !== null) {
				await noRunsNotDone(from);
			}
		},

		/**
		 * Splits Personal off now, and again every `everyMs`, until it is
		 * done or `signal` aborts: a split waits for the runs this computer
		 * walks, and a split cut short goes on. Its failures wait for the
		 * next try.
		 */
		keepFinishing(signal: AbortSignal, everyMs = 30_000): void {
			const attempt = () => {
				if (running || signal.aborted) return;
				locked(split).catch((error) => {
					if (!(error instanceof Refusal)) {
						console.error("[devices] the split of Personal failed:", error);
					}
				});
			};
			const first = setTimeout(attempt, 0);
			const timer = setInterval(attempt, everyMs);
			first.unref?.();
			timer.unref?.();
			signal.addEventListener(
				"abort",
				() => {
					clearTimeout(first);
					clearInterval(timer);
				},
				{ once: true },
			);
		},

		/** The split that started and is not done, if any. */
		unfinished: () => rows.unfinished(),
	};
}
