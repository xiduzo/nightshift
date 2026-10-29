import { randomUUID } from "node:crypto";
import { personalSpaceId, splitPersonalSpaceBatch } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { hostSpace, run } from "@nightshift/db/schema";
import {
	type Engine,
	type FlowDocuments,
	type SpaceDocuments,
	spaceProjectRows,
} from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import { and, eq } from "drizzle-orm";
import type { SplitResult, SplitState } from "../contract";
import type { HostLinks, HostSpaces } from "../links";
import { backupDatabase } from "./backup";
import { mergeRows } from "./merge-rows";
import { NOT_DONE } from "./personal-merge";
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
 * here, with their history; they no longer sync with the Host. A schedule
 * of theirs that names another Device is paused here: the Host still
 * fires it on that Device, and a run here too would be a second run of
 * it. It names no Device after the split, so when the person turns it on
 * it fires here, the one Replica of the new Space. The result counts
 * them (`unpinned`). A schedule that names this computer stays as it
 * is. The rows
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
 * 3. `moved`: one Space move (`Engine.moveProjects`) of this
 *    computer's runs only. No run becomes active in the Space from the
 *    last check for runs this computer walks through its batch. The
 *    schedules that name another Device name none and are paused first.
 *    The batch makes the new Space the Person's personal Space
 *    (`splitPersonalSpaceBatch`), moves the rows, names the Host's Space
 *    "Personal on <Host>", ends a merge that is not done, and sets this
 *    state with the count of the paused schedules.
 * 4. `done`: the new Space's document has its Projects and Clones.
 *
 * A split that stopped goes on from its state, by itself
 * (`keepFinishing`).
 */
export type PersonalSpaceSplit = ReturnType<typeof createPersonalSplit>;

export const SPLIT_WORDS = {
	notDone: (count: number) =>
		count === 1
			? "A run on this computer is not done yet. Let it finish or stop it, then leave."
			: `${count} runs on this computer are not done yet. Let them finish or stop them, then leave.`,
} as const;

export type PersonalSplitDeps = {
	db: Database;
	engine: Pick<Engine, "space" | "moveProjects"> & {
		hostSpaces: Pick<HostSpaces, "hostOf">;
	};
	hostLinks: Pick<HostLinks, "get">;
	spaces: Pick<SpaceDocuments, "open">;
	flows: Pick<FlowDocuments, "open">;
	/** This computer's Device. */
	self: { id: string; name: string };
	/** The Person who owns this computer. */
	ownerId: string;
	dataDir: string;
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
	/**
	 * The split under way in this process: one at a time, and the next
	 * waits for it. The revoke hook, `nightshift leave` and the timer may
	 * ask at once.
	 */
	let last: Promise<unknown> = Promise.resolve();
	let busy = false;

	function serial<T>(work: () => Promise<T>): Promise<T> {
		const task = last
			.catch(() => {})
			.then(async () => {
				busy = true;
				try {
					return await work();
				} finally {
					busy = false;
				}
			});
		last = task;
		return task;
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
		let unpinned = row.unpinned;

		if (state === "planned") {
			const fromName = `Personal on ${row.hostName}`;
			const moved = await engine.moveProjects({
				from,
				plan: async () => {
					await noRunsNotDone(from);
					const ids = await projectsHere(from);
					return {
						projects: Object.fromEntries(
							ids.map((id) => [id, { spaceId: to, projectId: id }]),
						),
						personMap: { [row.hostPersonId]: row.personId },
						ownRunsOnly: true,
						// The Host fires a schedule that names another Device there
						// still. Turned on, it fires here. Its Person goes with its
						// Device: it names who the runs there ran for.
						schedule: (schedule) => {
							if (
								schedule.device === undefined ||
								schedule.device === self.name
							) {
								return schedule;
							}
							const { device: _device, person: _person, ...rest } = schedule;
							return { ...rest, enabled: false };
						},
					};
				},
				statements: async (done) => [
					...(await splitPersonalSpaceBatch(db, {
						personId: row.personId,
						from,
						to,
						fromName,
					})),
					db
						.update(hostSpace)
						.set({ name: fromName, updatedAt: new Date() })
						.where(eq(hostSpace.spaceId, from)),
					merges.abandon(),
					rows.moved(to, {
						projects: done.projects,
						runs: done.runIds.length,
						unpinned: done.schedules,
					}),
				],
			});
			projects = moved.projects;
			runs = moved.runIds.length;
			unpinned = moved.schedules;
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
			unpinned,
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
			return serial(split);
		},

		/**
		 * The Space that splits off when this computer leaves its home Host
		 * now: its personal Space when a Host keeps it, else null. Refuses
		 * when a run this computer walks there is not done. Changes nothing.
		 */
		async check(): Promise<string | null> {
			const from = await personalSpaceId(db, deps.ownerId);
			if (from === null || (await engine.hostSpaces.hostOf(from)) === null) {
				return null;
			}
			await noRunsNotDone(from);
			return from;
		},

		/** The latest split of that Space, whoever ran it, if any. */
		async of(fromSpace: string): Promise<SplitResult | null> {
			const row = await rows.of(fromSpace);
			return row
				? {
						state: row.state,
						spaceId: row.toSpace,
						projects: row.projects.length,
						runs: row.runs,
						unpinned: row.unpinned,
						backup: row.backup,
					}
				: null;
		},

		/**
		 * Splits Personal off now, and again every `everyMs`, until it is
		 * done or `signal` aborts: a split waits for the runs this computer
		 * walks, and a split cut short goes on. Its failures wait for the
		 * next try.
		 */
		keepFinishing(signal: AbortSignal, everyMs = 30_000): void {
			const attempt = () => {
				if (busy || signal.aborted) return;
				serial(split).catch((error) => {
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
