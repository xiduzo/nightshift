import {
	adoptPersonalSpaceBatch,
	personalSpaceId,
	spaceExists,
} from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { device } from "@nightshift/db/schema";
import {
	type Engine,
	type FlowDocuments,
	HostUnreachableError,
	type PeerProjects,
} from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import { and, eq, isNull } from "drizzle-orm";
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
	isOlderHost,
	type Link,
} from "../links";
import { backupDatabase } from "./backup";
import type { MembershipRecord, MergeRow, MergeTarget } from "./record";

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
 * 1. Checks (`checks`, the one list): a home Host, this computer is not
 *    a Host with paired Devices (its Personal stays as it is), Personal
 *    is not merged yet, the Host answers now and lists a personal Space,
 *    and no run in Personal is not done.
 * 2. `planned`: a copy of the whole database in the data directory
 *    (`VACUUM INTO`), before any change.
 * 3. `mapped`: the Host takes the Projects (`sync.mergePersonal`) and
 *    says where each one goes. It answers the same when it is asked
 *    again.
 * 4. `moved`: one Space move (`Engine.moveProjects`), with this
 *    computer's events numbered after its latest. No run becomes active
 *    in Personal from the last check for runs that are not done through
 *    its batch. The schedules that name no device are pinned to this
 *    computer first, so their runs keep running where they ran: the Host
 *    fires them from now on, and starts their runs here. The batch moves
 *    every row of the Projects and their runs, makes the Host's Space
 *    this computer's personal Space named "Personal"
 *    (`adoptPersonalSpaceBatch`), and sets this state.
 * 5. What the old Space leaves goes once nothing names it: its Space
 *    document and its facts of no run (a Member that joined). The flow
 *    documents of a Project that joins another merge into it, once the
 *    Host's copy of that document is here.
 * 6. `pushed`: the Host has the moved runs: the exchange pushed them.
 *
 * `preview` answers what a merge would do and changes nothing: the Host
 * answers a dry run. A merge that stopped goes on from its state: after
 * `moved` by itself, before it only when the person asks again. The
 * membership runs each step (`HomeMembership`).
 */

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
	busy: "Night Shift moves your Personal now. Wait until it is done.",
} as const;

/**
 * The statuses of a run that is not done: a merge and a split wait for them.
 * An interrupted run has ended, as a stopped one has: it moves along, and
 * nobody can stop it to let the merge go on.
 */
export const NOT_DONE = ["running", "waiting", "sleeping"] as const;

/** The check of a merge that failed: why it does not go on now. */
export type MergeHeld = {
	held: "noHome" | "isHost" | "merged" | "offline" | "notListed" | "notDone";
	refusal: Refusal;
};

/** Every check of a merge passed: whom it merges, and how. */
type MergeReady = {
	held: null;
	host: { id: string; name: string };
	link: Link;
	from: string;
	to: string;
	/** How many runs Personal has. */
	runs: number;
};

export type MergeDeps = {
	db: Database;
	engine: Pick<Engine, "space" | "moveProjects" | "flows" | "forgetSpace"> & {
		exchange: Pick<RunHistoryExchange, "pushed">;
		hostSpaces: Pick<HostSpaces, "listed">;
		projects: Pick<PeerProjects, "ofSpace">;
	};
	links: Pick<DeviceLinks, "get">;
	/** The home Host this computer merges into (`HostLinks.home`). */
	hostLinks: Pick<HostLinks, "home">;
	/** The flow documents, to wait until the Host's copies arrived. */
	flows: Pick<FlowDocuments, "open">;
	/** This computer's Device. */
	self: { id: string; name: string };
	/** The Person who owns this computer. */
	ownerId: string;
	dataDir: string;
	now?: () => number;
	/** How long a merge waits for the Host's copy of a flow document. Default 30 s. */
	syncWaitMs?: number;
	/** How long a merge waits for the exchange to push the moved runs. Default 20 s. */
	pushWaitMs?: number;
	/** How often it looks while it waits. Default 250 ms. */
	pollMs?: number;
};

/** The steps of a merge, for the membership: it runs one at a time. */
export function mergeSteps(deps: MergeDeps & { record: MembershipRecord }) {
	const { db, engine, self } = deps;
	const now = deps.now ?? Date.now;
	const rows = deps.record.merges;
	const pollMs = deps.pollMs ?? 250;

	function held(why: MergeHeld["held"], words?: string): MergeHeld {
		const kind =
			why === "offline" || why === "notListed" ? "unavailable" : "conflict";
		return {
			held: why,
			refusal: new Refusal(
				kind,
				words ?? MERGE_WORDS[why as keyof typeof MERGE_WORDS],
			),
		};
	}

	/** The link to the Host when it answers now. */
	function online(hostId: string): Link | null {
		const link = deps.links.get(hostId);
		return link?.state().status === "online" ? link : null;
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

	/** The runs of Personal, and how many of them are not done. */
	async function runsOf(spaceId: string) {
		let total = 0;
		let notDone = 0;
		for (const runs of (await engine.space(spaceId).projectRuns()).values()) {
			total += runs.total;
			for (const status of NOT_DONE) notDone += runs.statuses[status] ?? 0;
		}
		return { total, notDone };
	}

	function notDoneHeld(notDone: number): MergeHeld {
		return held(
			"notDone",
			notDone === 1
				? "A run in Personal is not done yet. Let it finish or stop it, then merge."
				: `${notDone} runs in Personal are not done yet. Let them finish or stop them, then merge.`,
		);
	}

	/**
	 * Every check of a merge, in order: the first that fails holds it. A
	 * merge that started (`started`) has its Host and Spaces: it checks
	 * from the Host's answer on.
	 */
	async function checks(started?: MergeRow): Promise<MergeReady | MergeHeld> {
		const home = await deps.hostLinks.home();
		let host: { id: string; name: string };
		let from: string;
		let listed: { id: string; personal: boolean }[] | null = null;
		if (started) {
			host = {
				id: started.hostId,
				name: home?.hostId === started.hostId ? home.name : "",
			};
			from = started.fromSpace;
		} else {
			if (!home) return held("noHome");
			if (await hostsDevices()) return held("isHost");
			host = { id: home.hostId, name: home.name };
			const personal = await personalSpaceId(db, deps.ownerId);
			listed = await engine.hostSpaces.listed(host.id);
			if (personal === null || listed.some((space) => space.id === personal)) {
				return held("merged");
			}
			from = personal;
		}
		const link = online(host.id);
		if (!link) return held("offline");
		listed ??= await engine.hostSpaces.listed(host.id);
		const to = listed.find((space) => space.personal);
		if (!to) return held("notListed");
		const runs = await runsOf(from);
		if (runs.notDone > 0) return notDoneHeld(runs.notDone);
		return { held: null, host, link, from, to: to.id, runs: runs.total };
	}

	/** The checks, or the refusal of the first that fails. */
	async function ready(started?: MergeRow): Promise<MergeReady> {
		const checked = await checks(started);
		if (checked.held !== null) throw checked.refusal;
		return checked;
	}

	/** The Host's answer for the Projects of `from`: a dry run changes nothing there. */
	async function ask(
		link: Link,
		from: string,
		joined: readonly string[],
		dryRun: boolean,
	): Promise<HostAnswer> {
		const projects = await engine.projects.ofSpace(from);
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
			if (isOlderHost(error)) {
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

	/** How many schedules of the project name no device. A removed project has none that fire. */
	async function unpinned(projectId: string, removed: boolean) {
		if (removed) return 0;
		const { schedules } = await engine.flows.schedules(projectId, {
			validate: false,
		});
		return schedules.filter((schedule) => schedule.device === undefined).length;
	}

	async function preview(
		input: { join?: readonly string[] } = {},
	): Promise<MergePreview> {
		const { host, link, from, to, runs } = await ready();
		const answer = await ask(link, from, input.join ?? [], true);
		const targets = targetsOf(answer, to);
		const projects = await engine.projects.ofSpace(from);
		const projectRuns = await engine.space(from).projectRuns();
		const elsewhere = new Map(answer.elsewhere.map((e) => [e.projectId, e]));
		const views: MergeProjectView[] = [];
		for (const p of projects) {
			const target = targets[p.id];
			if (!target) continue;
			const shared = elsewhere.get(p.id);
			const renamed =
				target.projectId === p.id
					? {}
					: (
							await engine.flows.planMerge(
								p.id,
								target.projectId,
								answer.personMap,
							)
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
				schedules: await unpinned(p.id, p.removedAt !== null),
			});
		}
		return { host, projects: views, runs };
	}

	/** Waits until `done` says yes, up to `ms`. */
	async function until(done: () => Promise<boolean>, ms: number) {
		const end = now() + ms;
		while (true) {
			if (await done()) return true;
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
			const { link, to: personal } = await ready(row);
			const answer = await ask(link, from, row.joined, false);
			if (answer.spaceId !== personal) {
				throw new Error(
					`The Host answered with the Space ${answer.spaceId}, not ${personal}.`,
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
			const targets = projectMap;
			const moved = await engine.moveProjects({
				from,
				plan: async () => {
					// The last check of the runs, under the hold.
					const { notDone } = await runsOf(from);
					if (notDone > 0) throw notDoneHeld(notDone).refusal;
					return {
						projects: targets,
						personMap,
						renumber: true,
						// The Host fires the schedules from now on; their runs keep
						// running where they ran: on this computer.
						schedule: (schedule) =>
							schedule.device === undefined
								? { ...schedule, device: self.name }
								: schedule,
					};
				},
				statements: async () => [
					...(await adoptPersonalSpaceBatch(db, {
						personId: row.personId,
						from,
						to,
					})),
					rows.moved(from),
				],
			});
			runIds.push(...moved.runIds);
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

	/**
	 * Removes what the old Space left once nothing names it: its Space
	 * row is gone, then the engine forgets it (`Engine.forgetSpace`: its
	 * facts of no run here, its document). Runs again safely.
	 */
	async function cleanUp(from: string): Promise<boolean> {
		if (await spaceExists(db, from)) return false;
		return engine.forgetSpace(from);
	}

	/** What follows the batch: the old Space, the flow documents. Runs again safely. */
	async function finishMoved(
		hostId: string,
		from: string,
		projectMap: Record<string, MergeTarget>,
		personMap: Record<string, string>,
	) {
		// A Project the Host did not take stays: the old Space keeps it.
		await cleanUp(from);

		const pairs = Object.entries(projectMap).filter(
			([source, target]) => source !== target.projectId,
		);
		if (pairs.length === 0) return;
		const link = online(hostId);
		if (!link) throw held("offline").refusal;
		// The Host's copies of the documents they join come over the link.
		for (const [source, target] of pairs) {
			const destination = await deps.flows.open(target.projectId);
			const synced = await link.inStep(
				[destination.current.name, destination.history.name],
				{ timeoutMs: deps.syncWaitMs ?? 30_000 },
			);
			if (!synced) {
				throw new Refusal(
					"unavailable",
					"The flows of your projects are still on their way from your home Host. Night Shift merges them when they are here.",
				);
			}
			await engine.flows.merge(source, target.projectId, {
				persons: personMap,
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
		return until(
			() => engine.exchange.pushed(hostId, spaces, self.id),
			deps.pushWaitMs ?? 20_000,
		);
	}

	return {
		checks,
		preview,
		resume,

		/** A new merge after its checks: the copy of the database, then its states. */
		async start(input: { join?: readonly string[] }): Promise<MergeResult> {
			const { host, from } = await ready();
			const backup = await backupDatabase(db, deps.dataDir, now());
			const row = await rows.plan({
				fromSpace: from,
				hostId: host.id,
				personId: deps.ownerId,
				joined: input.join ?? [],
				backup,
			});
			return resume(row);
		},

		/**
		 * Whether Personal waits to merge, and why it cannot run now
		 * (`blocked`). `started`: the merge that started and is not done.
		 */
		async pending(started: MergeRow | null): Promise<MergePending> {
			if (started) {
				const link = deps.links.get(started.hostId);
				return {
					pending: true,
					state: started.state,
					hostName: (await deps.hostLinks.home())?.name ?? null,
					blocked:
						link?.state().status === "online" ? null : MERGE_WORDS.offline,
				};
			}
			const checked = await checks();
			if (
				checked.held === "noHome" ||
				checked.held === "isHost" ||
				checked.held === "merged"
			) {
				return { pending: false, state: null, hostName: null, blocked: null };
			}
			return {
				pending: true,
				state: null,
				hostName: (await deps.hostLinks.home())?.name ?? null,
				blocked: checked.held === null ? null : checked.refusal.message,
			};
		},

		/** Removes what a merge that is done left of the old Space: a merge of an older version did not. */
		async cleanUpDone(): Promise<void> {
			const latest = await rows.latest();
			if (latest?.state === "pushed") await cleanUp(latest.fromSpace);
		},
	};
}
