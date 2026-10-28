import { adoptPersonalSpaceBatch, personalSpaceId } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import {
	device,
	event,
	organization,
	project,
	run,
} from "@nightshift/db/schema";
import {
	type Engine,
	type FlowDocument,
	type FlowDocuments,
	HostUnreachableError,
	mergeFlowDocuments,
	planFlowMerge,
	type SpaceDocuments,
	spaceMoveBatch,
	spaceProjectRows,
	spaceRunIds,
} from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import { ORPCError } from "@orpc/client";
import { and, eq, isNull, notExists, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type {
	PersonalMerge as HostAnswer,
	MergePending,
	MergePreview,
	MergeProjectView,
	MergeResult,
	MergeState,
} from "../contract";
import type { RunHistoryExchange } from "../exchange";
import {
	type DeviceLinks,
	fromHost,
	type HostLinks,
	type HostSpaces,
	type Link,
} from "../links";
import { backupDatabase } from "./backup";
import { type MergeRow, type MergeTarget, mergeRows } from "./merge-rows";
import { runCommandMoves } from "./run-commands";

/**
 * The merge of this computer's own personal Space ("Personal") into its
 * Person's personal Space on its home Host (ADR 1): after it, the Person
 * has one Space named "Personal", which the Host keeps. Its Projects,
 * Clones, runs, events, Gates, kept variables, flows and schedules move.
 * A remote on both sides becomes one Project with both histories.
 *
 * It rewrites this computer's database, so it goes in states that a
 * crash cannot leave half done (`space_merge`):
 *
 * 1. Checks: a home Host that answers now, a personal Space on it, no
 *    run in Personal that is not done, and this computer is not a Host
 *    with paired Devices (its Personal stays as it is). One merge at a
 *    time in this process.
 * 2. `planned`: a copy of the whole database in the data directory
 *    (`VACUUM INTO`), before any change.
 * 3. `mapped`: the Host takes the Projects (`sync.mergePersonal`) and
 *    says where each one goes. It answers the same when it is asked
 *    again. The schedules that name no device are pinned to this
 *    computer, so their runs keep running where they ran: the Host
 *    fires them from now on, and starts their runs here.
 * 4. `moved`: no run starts in Personal from the last check for runs
 *    that are not done through the batch (`Engine.holdStarts`). One
 *    `db.batch` moves every row (`spaceMoveBatch`, with this
 *    computer's events numbered after its latest), makes the Host's
 *    Space this computer's personal Space named "Personal"
 *    (`adoptPersonalSpaceBatch`), moves the commands of the moved runs
 *    (`run_command`), adds what the composition root moves of the same
 *    runs (`moveStatements`: the notifier's deliveries), and sets this
 *    state. Then the engine reads the moved runs again.
 * 5. What the old Space leaves goes once nothing names it: its Space
 *    document and its facts of no run (a Member that joined). The flow
 *    documents of a Project that joins another merge into it, once the
 *    Host's copy of that document is here.
 * 6. `pushed`: the Host has the moved runs: the exchange pushed them.
 *
 * `preview` answers what a merge would do and changes nothing: the Host
 * answers a dry run. A merge that stopped goes on from its state: after
 * `moved` by itself (`finish`), before it only when the person asks again.
 */
export type PersonalSpaceMerge = ReturnType<typeof createPersonalMerge>;

/** What the composition root adds to the batch that moves the rows: one entry per Space the runs go to. */
export type MergeMove = { from: string; to: string; runIds: readonly string[] };

/** Why a merge cannot start now. */
export const MERGE_WORDS = {
	noHome: "This computer has no home Host. Join one first.",
	merged: "Your Personal is merged with your home Host already.",
	offline: "Your home Host does not answer now. Try again when it is online.",
	notListed:
		"Your home Host does not show your personal Space yet. Try again in a minute.",
	isHost:
		"Other devices use this computer as their Host. Its Personal stays as it is.",
	olderHost:
		"Your home Host runs an older version of Night Shift. Update it, then merge.",
	busy: "Night Shift merges your Personal already. Wait until it is done.",
} as const;

/**
 * The statuses of a run that is not done: a merge and a split wait for them.
 * An interrupted run has ended, as a stopped one has: it moves along, and
 * nobody can stop it to let the merge go on.
 */
export const NOT_DONE = ["running", "waiting", "sleeping"] as const;

export type PersonalMergeDeps = {
	db: Database;
	engine: Pick<Engine, "space" | "reindex" | "holdStarts"> & {
		exchange: Pick<RunHistoryExchange, "rowsAfter" | "cursorsWith">;
		hostSpaces: Pick<HostSpaces, "listed">;
	};
	links: Pick<DeviceLinks, "get">;
	hostLinks: Pick<HostLinks, "list">;
	spaces: Pick<SpaceDocuments, "open" | "remove">;
	flows: Pick<FlowDocuments, "open">;
	/** This computer's Device. */
	self: { id: string; name: string };
	/** The Person who owns this computer. */
	ownerId: string;
	dataDir: string;
	/** What the composition root moves of the same runs, in the same batch. */
	moveStatements?(moves: readonly MergeMove[]): BatchItem<"sqlite">[];
	now?: () => number;
	/** How long a merge waits for the Host's copy of a flow document. Default 30 s. */
	syncWaitMs?: number;
	/** How long a merge waits for the exchange to push the moved runs. Default 20 s. */
	pushWaitMs?: number;
	/** How often it looks while it waits. Default 250 ms. */
	pollMs?: number;
};

export function createPersonalMerge(deps: PersonalMergeDeps) {
	const { db, engine, self } = deps;
	const now = deps.now ?? Date.now;
	const rows = mergeRows(db);
	const pollMs = deps.pollMs ?? 250;
	/** The merge under way in this process: one at a time. */
	let running: Promise<unknown> | null = null;

	async function locked<T>(work: () => Promise<T>): Promise<T> {
		if (running) throw new Refusal("conflict", MERGE_WORDS.busy);
		const task = work();
		running = task;
		try {
			return await task;
		} finally {
			running = null;
		}
	}

	/** The home Host, and its link when it answers now. */
	async function home(): Promise<{ id: string; name: string }> {
		const link = (await deps.hostLinks.list()).find(
			(l) => l.role === "home" && l.revokedAt === null,
		);
		if (!link) throw new Refusal("conflict", MERGE_WORDS.noHome);
		return { id: link.hostId, name: link.name };
	}

	function online(hostId: string): Link {
		const link = deps.links.get(hostId);
		if (!link || link.state().status !== "online") {
			throw new Refusal("unavailable", MERGE_WORDS.offline);
		}
		return link;
	}

	/** This computer keeps Devices of its own as a Host. */
	async function hostsDevices(): Promise<boolean> {
		const [paired] = await db
			.select({ id: device.id })
			.from(device)
			.where(and(eq(device.self, false), isNull(device.revokedAt)))
			.limit(1);
		return paired !== undefined;
	}

	/** Refuses while a run of Personal is not done. */
	async function noRunsNotDone(spaceId: string): Promise<number> {
		let total = 0;
		let notDone = 0;
		for (const runs of (await engine.space(spaceId).projectRuns()).values()) {
			total += runs.total;
			for (const status of NOT_DONE) notDone += runs.statuses[status] ?? 0;
		}
		if (notDone > 0) {
			throw new Refusal(
				"conflict",
				notDone === 1
					? "A run in Personal is not done yet. Let it finish or stop it, then merge."
					: `${notDone} runs in Personal are not done yet. Let them finish or stop them, then merge.`,
			);
		}
		return total;
	}

	/** Every check before a new merge: the Spaces it merges and the Host. */
	async function check() {
		const host = await home();
		if (await hostsDevices()) {
			throw new Refusal("conflict", MERGE_WORDS.isHost);
		}
		const from = await personalSpaceId(db, deps.ownerId);
		const listed = await engine.hostSpaces.listed(host.id);
		const to = listed.find((space) => space.personal);
		if (from === null || listed.some((space) => space.id === from)) {
			throw new Refusal("conflict", MERGE_WORDS.merged);
		}
		const link = online(host.id);
		if (!to) throw new Refusal("unavailable", MERGE_WORDS.notListed);
		const runs = await noRunsNotDone(from);
		return { host, link, from, to: to.id, runs };
	}

	/** The Host's answer for the Projects of `from`: a dry run changes nothing there. */
	async function ask(
		link: Link,
		from: string,
		joined: readonly string[],
		dryRun: boolean,
	): Promise<HostAnswer> {
		const projects = await spaceProjectRows(db, from, self.id);
		try {
			return await link.call((client) =>
				client.sync.mergePersonal({
					personId: deps.ownerId,
					projects: projects.map((p) => ({
						id: p.id,
						name: p.name,
						remote: p.remote,
						createdAt: p.createdAt,
						removedAt: p.removedAt,
						clone: p.clone,
					})),
					join: [...joined],
					dryRun,
				}),
			);
		} catch (error) {
			if (
				error instanceof ORPCError &&
				(error.code === "NOT_FOUND" || error.status === 404)
			) {
				throw new Refusal("unavailable", MERGE_WORDS.olderHost, {
					cause: error,
				});
			}
			if (error instanceof HostUnreachableError) {
				throw new Refusal("unavailable", MERGE_WORDS.offline, {
					cause: error,
				});
			}
			throw fromHost(error);
		}
	}

	/** Each Project of `from`: its Space and id on the Host. */
	function targetsOf(
		answer: HostAnswer,
		to: string,
	): Record<string, MergeTarget> {
		const shared = new Map(
			answer.elsewhere
				.filter((e) => e.joined)
				.map((e) => [e.projectId, e.spaceId]),
		);
		return Object.fromEntries(
			Object.entries(answer.projectMap).map(([source, projectId]) => [
				source,
				{ spaceId: shared.get(source) ?? to, projectId },
			]),
		);
	}

	/** The schedules of a flow document that name no device. */
	function unpinned(document: FlowDocument): string[] {
		return [...document.schedules.entries()].flatMap(([key, value]) => {
			const device = (value as { device?: unknown } | null)?.device;
			return value !== null && typeof value === "object" && device === undefined
				? [key]
				: [];
		});
	}

	async function preview(input: { join?: readonly string[] } = {}) {
		const { host, link, from, to, runs } = await check();
		const answer = await ask(link, from, input.join ?? [], true);
		const targets = targetsOf(answer, to);
		const projects = await spaceProjectRows(db, from, self.id);
		const projectRuns = await engine.space(from).projectRuns();
		const elsewhere = new Map(answer.elsewhere.map((e) => [e.projectId, e]));
		const views: MergeProjectView[] = [];
		for (const p of projects) {
			const target = targets[p.id];
			if (!target) continue;
			const shared = elsewhere.get(p.id);
			const source = await deps.flows.open(p.id);
			const renamed =
				target.projectId === p.id
					? {}
					: planFlowMerge(
							source,
							await deps.flows.open(target.projectId),
							answer.personMap,
						).flows;
			views.push({
				id: p.id,
				name: p.name,
				remote: p.remote,
				removed: p.removedAt !== null,
				runs: projectRuns.get(p.id)?.total ?? 0,
				into: shared
					? shared.joined
						? "shared"
						: "apart"
					: target.projectId === p.id
						? "new"
						: "same-remote",
				sharedSpace: shared
					? { id: shared.spaceId, name: shared.spaceName }
					: null,
				renamedFlows: Object.entries(renamed).map(([fromName, toName]) => ({
					from: fromName,
					to: toName,
				})),
				schedules: unpinned(source).length,
			});
		}
		return { host, projects: views, runs } satisfies MergePreview;
	}

	/** Waits until `ready` says yes, up to `ms`. */
	async function until(ready: () => Promise<boolean>, ms: number) {
		const end = now() + ms;
		while (true) {
			if (await ready()) return true;
			if (now() >= end) return false;
			await Bun.sleep(pollMs);
		}
	}

	/** Goes on from the merge's state, as far as it can now. */
	async function resume(row: MergeRow): Promise<MergeResult> {
		const from = row.fromSpace;
		let state: MergeState = row.state;
		let projectMap = row.projectMap;
		let personMap = row.personMap;
		let to = row.toSpace;
		const runIds: string[] = [];

		if (state === "planned") {
			const link = online(row.hostId);
			await noRunsNotDone(from);
			const listed = await engine.hostSpaces.listed(row.hostId);
			const personal = listed.find((space) => space.personal);
			if (!personal) throw new Refusal("unavailable", MERGE_WORDS.notListed);
			const answer = await ask(link, from, row.joined, false);
			if (answer.spaceId !== personal.id) {
				throw new Error(
					`The Host answered with the Space ${answer.spaceId}, not ${personal.id}.`,
				);
			}
			to = answer.spaceId;
			projectMap = targetsOf(answer, to);
			personMap = answer.personMap;
			await rows.mapped(from, { toSpace: to, projectMap, personMap });
			state = "mapped";
		}
		if (to === null) throw new Error("A mapped merge has no Space to go to.");

		if (state === "mapped") {
			// No run starts in Personal from its last check through the batch.
			const release = await engine.holdStarts(from);
			try {
				await noRunsNotDone(from);
				// The Host fires the schedules from now on; their runs keep
				// running where they ran: on this computer.
				for (const source of Object.keys(projectMap)) {
					const document = await deps.flows.open(source);
					const keys = unpinned(document);
					if (keys.length === 0) continue;
					await document.current.change(() => {
						for (const key of keys) {
							const value = document.schedules.get(key) as Record<
								string,
								unknown
							>;
							document.schedules.set(key, { ...value, device: self.name });
						}
					});
				}
				const bySpace = new Map<string, Record<string, string>>();
				for (const [source, target] of Object.entries(projectMap)) {
					bySpace.set(target.spaceId, {
						...bySpace.get(target.spaceId),
						[source]: target.projectId,
					});
				}
				const statements: BatchItem<"sqlite">[] = [];
				const moves: MergeMove[] = [];
				for (const [space, map] of bySpace) {
					const ids = await spaceRunIds(db, from, Object.keys(map));
					runIds.push(...ids);
					moves.push({ from, to: space, runIds: ids });
					statements.push(
						...(await spaceMoveBatch(db, {
							from,
							to: space,
							projectMap: map,
							personMap,
							walkerId: self.id,
						})),
					);
				}
				statements.push(
					...(await adoptPersonalSpaceBatch(db, {
						personId: row.personId,
						from,
						to,
					})),
					...runCommandMoves(db, moves, personMap),
					...(deps.moveStatements?.(moves) ?? []),
					rows.moved(from),
				);
				await db.batch(
					statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
				);
				engine.reindex(runIds);
			} finally {
				release();
			}
			state = "moved";
		}

		if (state === "moved") {
			await finishMoved(row.hostId, from, projectMap, personMap);
			if (await pushed(row.hostId, projectMap)) {
				await rows.pushed(from);
				state = "pushed";
			}
		}
		const projects = Object.keys(projectMap).length;
		return { state, projects, runs: runIds.length, backup: row.backup };
	}

	/** Whether this Replica still has the old Space, or a Project or run of it. */
	async function stillHere(from: string): Promise<boolean> {
		const [left] = await db
			.select({ id: organization.id })
			.from(organization)
			.where(eq(organization.id, from))
			.union(
				db
					.select({ id: project.id })
					.from(project)
					.where(eq(project.spaceId, from)),
			)
			.union(db.select({ id: run.id }).from(run).where(eq(run.spaceId, from)))
			.limit(1);
		return left !== undefined;
	}

	/**
	 * Removes what the old Space left once nothing names it: its document,
	 * and its events that belong to no run here (a Member that joined).
	 * Runs again safely.
	 */
	async function cleanUp(from: string): Promise<boolean> {
		if (await stillHere(from)) return false;
		await db
			.delete(event)
			.where(
				and(
					eq(event.spaceId, from),
					or(
						isNull(event.runId),
						notExists(
							db
								.select({ id: run.id })
								.from(run)
								.where(eq(run.id, event.runId)),
						),
					),
				),
			);
		await deps.spaces.remove(from);
		return true;
	}

	/** What follows the batch: the old Space, the flow documents. Runs again safely. */
	async function finishMoved(
		hostId: string,
		from: string,
		projectMap: Record<string, MergeTarget>,
		personMap: Record<string, string>,
	) {
		if (!(await cleanUp(from))) {
			// A Project the Host did not take stays: the old Space keeps it.
			const old = await deps.spaces.open(from);
			const moved = Object.keys(projectMap);
			const stale = [...old.clones.keys()].filter((key) =>
				moved.some((id) => key.startsWith(`${id}/`)),
			);
			if (moved.some((id) => old.projects.has(id)) || stale.length > 0) {
				await old.change(() => {
					for (const id of moved) old.projects.delete(id);
					for (const key of stale) old.clones.delete(key);
				});
			}
		}

		const pairs = Object.entries(projectMap).filter(
			([source, target]) => source !== target.projectId,
		);
		if (pairs.length === 0) return;
		const link = online(hostId);
		// The Host's copies of the documents they join come over the link.
		link.check();
		for (const [source, target] of pairs) {
			const destination = await deps.flows.open(target.projectId);
			const synced = await until(
				async () =>
					link.synced(destination.current.name) &&
					link.synced(destination.history.name),
				deps.syncWaitMs ?? 30_000,
			);
			if (!synced) {
				throw new Refusal(
					"unavailable",
					"The flows of your projects are still on their way from your home Host. Night Shift merges them when they are here.",
				);
			}
			await mergeFlowDocuments(await deps.flows.open(source), destination, {
				persons: personMap,
				at: now(),
			});
		}
	}

	/** The Host has every moved run of this computer. */
	async function pushed(
		hostId: string,
		projectMap: Record<string, MergeTarget>,
	): Promise<boolean> {
		const spaces = [
			...new Set(Object.values(projectMap).map((t) => t.spaceId)),
		];
		if (spaces.length === 0) return true;
		return until(async () => {
			const { rows: rest } = await engine.exchange.rowsAfter({
				spaces,
				cursors: await engine.exchange.cursorsWith(hostId),
				only: self.id,
				limit: 1,
			});
			return rest.events.length === 0;
		}, deps.pushWaitMs ?? 20_000);
	}

	/**
	 * Whether this computer's Personal waits to merge, for a Device that
	 * joined its home Host before the merge existed, or a merge that
	 * stopped. Never merges by itself: the person confirms it. `blocked`:
	 * why it cannot run now. Cheap: no call to the Host.
	 */
	async function pending(): Promise<MergePending> {
		const started = await rows.unfinished();
		const host = await home().catch(() => null);
		if (started) {
			const link = deps.links.get(started.hostId);
			return {
				pending: true,
				state: started.state,
				hostName: host?.name ?? null,
				blocked: link?.state().status === "online" ? null : MERGE_WORDS.offline,
			};
		}
		const none = { pending: false, state: null, hostName: null, blocked: null };
		if (!host || (await hostsDevices())) return none;
		const from = await personalSpaceId(db, deps.ownerId);
		const listed = await engine.hostSpaces.listed(host.id);
		if (from === null || listed.some((space) => space.id === from)) {
			return none;
		}
		let blocked: string | null = null;
		try {
			online(host.id);
			if (!listed.some((space) => space.personal)) {
				throw new Refusal("unavailable", MERGE_WORDS.notListed);
			}
			await noRunsNotDone(from);
		} catch (error) {
			if (!(error instanceof Refusal)) throw error;
			blocked = error.message;
		}
		return { pending: true, state: null, hostName: host.name, blocked };
	}

	return {
		/** What a merge would do now. Refuses when it cannot run now. Changes nothing. */
		preview,

		pending,

		/**
		 * Merges Personal into the home Host's, or goes on with a merge that
		 * stopped. `join`: the Projects to move into the Project of a shared
		 * Space with their remote. Resolves with how far it came: `moved`
		 * when the Host does not have the runs yet (they follow).
		 */
		run(input: { join?: readonly string[] } = {}): Promise<MergeResult> {
			return locked(async () => {
				const started = await rows.unfinished();
				if (started) return resume(started);
				const { host, from } = await check();
				const backup = await backupDatabase(db, deps.dataDir, now());
				const row = await rows.plan({
					fromSpace: from,
					hostId: host.id,
					personId: deps.ownerId,
					joined: input.join ?? [],
					backup,
				});
				return resume(row);
			});
		},

		/**
		 * Goes on with a merge that moved its rows every `everyMs`, until it
		 * is done or `signal` aborts: its runs reach the Host when it
		 * answers. Its failures wait for the next try. Once at start, it
		 * removes what a merge that is done left of the old Space: a merge
		 * of an older version did not.
		 */
		keepFinishing(signal: AbortSignal, everyMs = 30_000): void {
			void (async () => {
				const latest = await rows.latest();
				if (latest?.state === "pushed") await cleanUp(latest.fromSpace);
			})().catch((error) => {
				console.error("[devices] the old Personal was not removed:", error);
			});
			const timer = setInterval(() => {
				if (running) return;
				void (async () => {
					const started = await rows.unfinished();
					if (started?.state !== "moved") return;
					await locked(() => resume(started));
				})().catch(() => {});
			}, everyMs);
			timer.unref?.();
			signal.addEventListener("abort", () => clearInterval(timer), {
				once: true,
			});
		},

		/** The merge that started and is not done, if any. */
		unfinished: () => rows.unfinished(),
	};
}
