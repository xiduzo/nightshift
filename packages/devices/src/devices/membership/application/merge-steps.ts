import type {
	Engine,
	FlowDocuments,
	PeerProjects,
	RowBatch,
} from "@nightshift/engine";
import type { Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { now as timeNow } from "@nightshift/time";
import type {
	PersonalMerge as HostAnswer,
	MergePending,
	MergePreview,
	MergeProjectView,
	MergeResult,
	MergeState,
} from "../../../contract";
import type { RunHistoryExchange } from "../../../exchange";
import type { DeviceLinks, HostLinks, HostSpaces, Link } from "../../../links";
import type { MergeRow, MergeTarget } from "../domain/membership-rows";
import {
	MERGE_WORDS,
	type MergeHeld,
	mergeHeld,
	NOT_DONE,
	notDoneHeld,
} from "../domain/words";
import { lateProjects } from "./late-projects";
import type {
	DatabaseCopy,
	EngineKernel,
	MembershipRecord,
	PairedDevices,
	PersonalSpaces,
	Wait,
} from "./ports";

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
 *    again. It is asked again when the Projects of Personal are not those
 *    it answered for: a person added one, or moved one away.
 * 4. `moved`: one Space move (`Engine.moveProjects`), with this
 *    computer's events numbered after its latest. No run becomes active
 *    in Personal from the last check for runs that are not done through
 *    its batch. The Host fires the schedules and runs their runs from then
 *    on. The batch moves
 *    every row of the Projects and their runs, makes the Host's Space
 *    this computer's personal Space named "Personal"
 *    (`adoptPersonalSpaceBatch`), and sets this state. It fails, and no
 *    row of it lands, while a Project of Personal is not in it.
 * 5. What the old Space leaves goes once nothing names it: its Space
 *    document and its facts of no run (a Member that joined). The flow
 *    documents of a Project that joins another merge into it, once the
 *    Host's copy of that document is here.
 * 6. `pushed`: the Host has the moved runs: the exchange pushed them.
 *
 * A Project that a merge of an older version left in the old Space goes to
 * the Host by itself (`moveLate`): the same steps, for those Projects.
 *
 * `preview` answers what a merge would do and changes nothing: the Host
 * answers a dry run. A merge that stopped goes on from its state: after
 * `moved` by itself, before it only when the person asks again. The
 * membership runs each step (`HomeMembership`).
 */

/** How often a merge asks the Host again because its Projects changed on the way. */
const MAX_ASKS = 3;

/** Every check of a merge passed: whom it merges, and how. */
export type MergeReady = {
	held: null;
	host: { id: string; name: string };
	link: Link;
	from: string;
	to: string;
	/** How many runs Personal has. */
	runs: number;
};

export type MergeDeps = {
	engine: Pick<Engine, "space" | "moveProjects" | "flows" | "forgetSpace"> & {
		exchange: Pick<RunHistoryExchange, "pushed">;
		hostSpaces: Pick<HostSpaces, "listed" | "keeper">;
		projects: Pick<PeerProjects, "ofSpace">;
	};
	links: Pick<DeviceLinks, "get">;
	/** The home Host this computer merges into (`HostLinks.home`). */
	hostLinks: Pick<HostLinks, "home">;
	/** The flow documents, to wait until the Host's copies arrived. */
	flows: Pick<FlowDocuments, "open">;
	personalSpaces: PersonalSpaces;
	pairedDevices: PairedDevices;
	databaseCopy: DatabaseCopy;
	wait: Wait;
	engineKernel: EngineKernel;
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
	const { engine, self } = deps;
	const now = deps.now ?? timeNow;
	const rows = deps.record.merges;
	const pollMs = deps.pollMs ?? 250;
	const held = mergeHeld;

	/** The link to the Host when it answers now. */
	function online(hostId: string): Link | null {
		const link = deps.links.get(hostId);
		return link?.state().status === "online" ? link : null;
	}

	/** The runs of Personal, and how many of them are not done. */
	async function runsOf(spaceId: string) {
		let total = 0;
		let notDone = 0;
		for (const runs of (
			await engine.space(spaceId, deps.engineKernel.nightShift).projectRuns()
		).values()) {
			total += runs.total;
			for (const status of NOT_DONE) notDone += runs.statuses[status] ?? 0;
		}
		return { total, notDone };
	}

	/**
	 * Every check of a merge, in order: the first that fails holds it. A
	 * merge that started (`started`) has its Host and Spaces: it checks
	 * from the Host's answer on.
	 */
	async function checks(started?: MergeRow): Promise<MergeReady | MergeHeld> {
		// A split ends first: until then Personal is the Host's it leaves.
		if ((await deps.record.unfinished())?.step === "split") {
			return held("leaving");
		}
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
			if (await deps.pairedDevices.hasPaired()) return held("isHost");
			host = { id: home.hostId, name: home.name };
			const personal = await deps.personalSpaces.personalId(deps.ownerId);
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
			return await link.call(
				(client) =>
					client.sync.mergePersonal({
						personId: deps.ownerId,
						projects: projects.map((p) => ({
							id: p.id,
							name: p.name,
							remote: p.remote,
							createdAt: p.createdAt,
							removedAt: p.removedAt,
							clone: p.clone,
							folder: p.folder,
						})),
						join: [...joined],
						dryRun,
					}),
				{ olderHost: MERGE_WORDS.olderHost },
			);
		} catch (error) {
			if (deps.engineKernel.isHostUnreachable(error)) {
				throw new Refusal("unavailable", MERGE_WORDS.offline, {
					cause: error,
				});
			}
			throw error;
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

	/**
	 * Whether the Host answered for other Projects than `from` has now: one
	 * was added since, or went to another Space.
	 */
	async function changed(
		from: string,
		projectMap: Record<string, MergeTarget>,
	): Promise<boolean> {
		const here = await engine.projects.ofSpace(from);
		return (
			here.length !== Object.keys(projectMap).length ||
			here.some((p) => !Object.hasOwn(projectMap, p.id))
		);
	}

	/**
	 * A schedule that a leave paused here only, as it goes to this Host: as it
	 * is to the Host that has the same document and goes on with it. Off in
	 * the document to any other one: nobody turned it on there.
	 */
	async function pausedElsewhere(
		hostId: string,
		targets: Record<string, MergeTarget>,
		personMap: Record<string, string>,
		to: string,
	) {
		const there = personMap[deps.ownerId] ?? deps.ownerId;
		const splits = await deps.record.splits.paused();
		return (schedule: Schedule, projectId: string): Schedule => {
			const last = splits.findLast((split) =>
				split.paused.some(
					(p) => p.projectId === projectId && p.scheduleId === schedule.id,
				),
			);
			if (!last || !schedule.enabled) return schedule;
			const target = targets[projectId];
			const same =
				last.hostId === hostId &&
				last.hostPersonId === there &&
				last.fromSpace === to &&
				target?.projectId === projectId &&
				target.spaceId === to;
			if (same) return schedule;
			const { person: _person, ...rest } = schedule;
			return { ...rest, enabled: false };
		};
	}

	const late = lateProjects(deps, { checks, ask, targetsOf, changed, runsOf });

	/** How many schedules of the project move to the Host. A removed project has none that fire. */
	async function schedulesOf(projectId: string, removed: boolean) {
		if (removed) return 0;
		const { schedules } = await engine.flows.schedules(projectId, {
			validate: false,
		});
		return schedules.length;
	}

	async function preview(
		input: { join?: readonly string[] } = {},
	): Promise<MergePreview> {
		const { host, link, from, to, runs } = await ready();
		const answer = await ask(link, from, input.join ?? [], true);
		const targets = targetsOf(answer, to);
		const projects = await engine.projects.ofSpace(from);
		const projectRuns = await engine
			.space(from, deps.engineKernel.nightShift)
			.projectRuns();
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
				schedules: await schedulesOf(p.id, p.removedAt !== null),
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
			await deps.wait.sleep(pollMs);
		}
	}

	/** Goes on from the merge's state, as far as it can now. */
	async function resume(row: MergeRow): Promise<MergeResult> {
		const from = row.fromSpace;
		let state: MergeState = row.state;
		let { projectMap, personMap } =
			row.state === "moved" && row.late ? row.late : row;
		let to = row.toSpace;
		const runIds: string[] = [];

		/** The Host takes the Projects of `from` as they are now. */
		async function map() {
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

		/** One Space move of every Project of `from`, with the runs under the hold checked. */
		async function move(to: string) {
			const targets = projectMap;
			const moved = await engine.moveProjects({
				from,
				plan: async () => {
					// The last checks, under the hold.
					const { notDone } = await runsOf(from);
					if (notDone > 0) throw notDoneHeld(notDone).refusal;
					if (await changed(from, targets)) throw held("changed").refusal;
					return {
						projects: targets,
						personMap,
						renumber: true,
						empties: true,
						schedule: await pausedElsewhere(row.hostId, targets, personMap, to),
					};
				},
				statements: async () =>
					[
						...((await deps.personalSpaces.adoptBatch({
							personId: row.personId,
							from,
							to,
						})) as unknown as readonly unknown[]),
						...(rows.moved(from) as unknown as readonly unknown[]),
					] as unknown as RowBatch,
			});
			runIds.push(...moved.runIds);
			state = "moved";
		}

		if (state === "planned") await map();
		for (let asks = 1; state === "mapped"; asks++) {
			if (await changed(from, projectMap)) await map();
			if (to === null) throw new Error("A mapped merge has no Space to go to.");
			try {
				await move(to);
			} catch (error) {
				// The batch of a move that does not empty `from` fails: ask again.
				if (asks >= MAX_ASKS || !(await changed(from, projectMap))) throw error;
			}
		}

		if (state === "moved") {
			await finishMoved(row.hostId, from, projectMap, personMap);
			await late.say(row);
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
		if (await deps.personalSpaces.exists(from)) return false;
		return engine.forgetSpace(from);
	}

	/** What follows the batch: the old Space, the flow documents. Runs again safely. */
	async function finishMoved(
		hostId: string,
		from: string,
		projectMap: Record<string, MergeTarget>,
		personMap: Record<string, string>,
	) {
		// Every Project of the old Space moved: the batch fails otherwise. One
		// that an older version left there keeps the rest of it (`moveLate`).
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
			const backup = await deps.databaseCopy.copy(deps.dataDir, now());
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

		/** Moves the Projects that done merges left here: a merge of an older version did. */
		async moveLate(): Promise<void> {
			for (const row of await rows.done()) {
				const moved = await late.moveOf(row);
				if (moved) await resume(moved);
			}
		},

		/** Removes what a merge that is done left of the old Space: a merge of an older version did not. */
		async cleanUpDone(): Promise<void> {
			const latest = await rows.latest();
			if (latest?.state === "pushed") await cleanUp(latest.fromSpace);
		},
	};
}
