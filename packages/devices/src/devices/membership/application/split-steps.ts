import type {
	Engine,
	FlowDocuments,
	PeerProjects,
	RowBatch,
	SpaceDocuments,
} from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import { now as timeNow } from "@nightshift/time";
import type { SplitResult, SplitState } from "../../../contract";
import type { HostSpaces } from "../../../links";
import type { SplitRow } from "../domain/membership-rows";
import { NOT_DONE, SPLIT_WORDS } from "../domain/words";
import { pausedSchedules } from "./paused-schedules";
import type {
	DatabaseCopy,
	EngineKernel,
	Ids,
	MembershipRecord,
	PersonalSpaces,
} from "./ports";

/**
 * The split of a personal Space off the one this computer's home Host
 * keeps, when this computer leaves that Host (ADR 1: leaving keeps a
 * copy).
 */

export type SplitDeps = {
	engine: Pick<Engine, "space" | "moveProjects"> & {
		flows: Pick<Engine["flows"], "merge" | "schedules" | "saveSchedules">;
		hostSpaces: Pick<HostSpaces, "hostOf" | "keeper" | "named">;
		projects: Pick<PeerProjects, "ofSpace">;
	};
	spaces: Pick<SpaceDocuments, "open">;
	flows: Pick<FlowDocuments, "open">;
	personalSpaces: PersonalSpaces;
	databaseCopy: DatabaseCopy;
	ids: Ids;
	engineKernel: EngineKernel;
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

/** The steps of a split, for the membership: it runs one at a time. */
export function splitSteps(deps: SplitDeps & { record: MembershipRecord }) {
	const { engine, self } = deps;
	const now = deps.now ?? timeNow;
	const rows = deps.record.splits;
	const merges = deps.record.merges;
	const paused = pausedSchedules(deps);

	/**
	 * The Person's personal Space when a Host keeps it and this computer
	 * has no link with access to that Host. Null when it is this
	 * computer's own, or the Host still has this computer.
	 */
	async function left(): Promise<Left | null> {
		const from = await deps.personalSpaces.personalId(deps.ownerId);
		if (from === null) return null;
		const keeper = await engine.hostSpaces.keeper(from);
		if (keeper === null) return null;
		const { hostId, link } = keeper;
		if (link && link.revokedAt === null) return null;
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
			.space(spaceId, deps.engineKernel.nightShift)
			.listRuns({ statuses: [...NOT_DONE] });
		const here = runs.filter((r) => r.walker.id === self.id).length;
		if (here > 0) throw new Refusal("conflict", SPLIT_WORDS.notDone(here));
	}

	/**
	 * The Projects that come along: a Clone here, a run this computer
	 * walked, or no folder: every Device has a project without one (ADR 22).
	 */
	async function projectsHere(from: string): Promise<string[]> {
		return (await engine.projects.ofSpace(from))
			.filter((p) => p.clone || p.walked || !p.folder)
			.map((p) => p.id);
	}

	/**
	 * The flows of a merge whose rows moved, and whose flows still wait for
	 * the Host: they merge here, without the Host's copies, before the batch
	 * of the split ends that merge. Only its row says which Project each of
	 * them goes to. Runs again safely. They stay this computer's own, and
	 * the split pauses their schedules with the others.
	 */
	async function mergeWaitingFlows(): Promise<void> {
		const merge = await merges.latest();
		if (merge?.state !== "moved") return;
		for (const [source, target] of Object.entries(merge.projectMap)) {
			if (source === target.projectId) continue;
			await engine.flows.merge(source, target.projectId, { persons: {} });
		}
	}

	/** Goes on from the split's state, to its end. */
	async function resume(row: SplitRow): Promise<SplitResult> {
		const { fromSpace: from, toSpace: to } = row;
		let state: SplitState = row.state;
		let projects = row.projects;
		let runs = row.runs;
		let unpinned = row.unpinned;

		if (state === "planned") {
			await mergeWaitingFlows();
			const moved = await engine.moveProjects({
				from,
				plan: async () => {
					await noRunsNotDone(from);
					const ids = await projectsHere(from);
					await paused.keep(row, ids);
					return {
						projects: Object.fromEntries(
							ids.map((id) => [id, { spaceId: to, projectId: id }]),
						),
						personMap: { [row.hostPersonId]: row.personId },
						ownRunsOnly: true,
						schedule: paused.pause,
					};
				},
				statements: async (done) =>
					[
						...((await deps.personalSpaces.splitBatch({
							personId: row.personId,
							from,
							to,
							hostName: row.hostName,
						})) as unknown as readonly unknown[]),
						engine.hostSpaces.named(from, `Personal on ${row.hostName}`),
						...(merges.abandon() as unknown as readonly unknown[]),
						...(rows.moved(to, {
							projects: done.projects,
							runs: done.runIds.length,
							unpinned: done.schedules,
						}) as unknown as readonly unknown[]),
					] as unknown as RowBatch,
			});
			projects = moved.projects;
			runs = moved.runIds.length;
			unpinned = moved.schedules;
			state = "moved";
		}

		if (state === "moved") {
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

	/**
	 * Splits Personal off when this computer left its Host, or goes on
	 * with the split that stopped (`started`). Null: nothing to split.
	 */
	async function splitOff(
		started: SplitRow | null,
	): Promise<SplitResult | null> {
		if (started) return resume(started);
		const leaving = await left();
		if (!leaving) return null;
		await noRunsNotDone(leaving.from);
		const backup = await deps.databaseCopy.copy(
			deps.dataDir,
			now(),
			"leaving-host",
		);
		const row = await rows.plan({
			toSpace: deps.ids.spaceId(),
			fromSpace: leaving.from,
			hostId: leaving.hostId,
			hostName: leaving.hostName,
			personId: deps.ownerId,
			hostPersonId: leaving.hostPersonId,
			backup,
		});
		return resume(row);
	}

	return {
		splitOff,

		/**
		 * Forgets a split that moved no row: the Host gave access back first,
		 * and Personal stays there (ADR 1: one Personal per home Host). What it
		 * paused is on again before the row goes. The copy of the database
		 * stays.
		 */
		async forget(row: SplitRow): Promise<void> {
			await paused.giveBack(row);
			await rows.forget(row.toSpace);
			console.warn(
				`[devices] The split of ${row.fromSpace} into ${row.toSpace} is forgotten: its Host gave access back. The copy of the database: ${row.backup}${row.paused === null ? ". The schedules it paused, if any, stay paused." : ""}`,
			);
		},

		/**
		 * The Space that splits off when this computer leaves its home Host
		 * now: its personal Space when a Host keeps it, else null.
		 */
		async check(): Promise<string | null> {
			const from = await deps.personalSpaces.personalId(deps.ownerId);
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
	};
}
