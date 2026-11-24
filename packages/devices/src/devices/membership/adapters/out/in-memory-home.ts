import type { RowBatch } from "@nightshift/engine";
import type { PersonalMerge, PersonalMergeInput } from "../../../../contract";
import type { HomeMembershipDeps } from "../../application/create-home-membership";
import { inMemoryMembershipRecord } from "./in-memory-membership-record";
import {
	inMemoryBatch,
	inMemoryBatches,
	inMemoryDatabaseCopy,
	inMemoryDeviceCopies,
	inMemoryEngineKernel,
	inMemoryIds,
	inMemoryPairedDevices,
	inMemoryPersonalSpaces,
	inMemoryWait,
	runInMemory,
} from "./in-memory-neighbours";

/** A Host that does not answer, and one that does not know this computer. */
export class HostDown extends Error {}
export class NotKnown extends Error {}

type Moving = Awaited<
	ReturnType<HomeMembershipDeps["engine"]["projects"]["ofSpace"]>
>[number];
type ProjectsMove = Parameters<HomeMembershipDeps["engine"]["moveProjects"]>[0];
type Schedule = Parameters<
	NonNullable<Awaited<ReturnType<ProjectsMove["plan"]>>["schedule"]>
>[0];
/** What a move took, as a test reads it. */
type Plan = {
	projects: Readonly<Record<string, { spaceId: string; projectId: string }>>;
	personMap?: Readonly<Record<string, string>>;
	renumber?: boolean;
	empties?: boolean;
	ownRunsOnly?: boolean;
};
type HostRow = NonNullable<
	Awaited<ReturnType<HomeMembershipDeps["hostLinks"]["home"]>>
>;
/** A run as the checks read it: where it is, who walks it. */
type Run = {
	id: string;
	spaceId: string;
	projectId: string;
	status: string;
	walker: string;
};

/** A Project of this computer's Personal. */
export function moving(id: string, more: Partial<Moving> = {}): Moving {
	return {
		id,
		spaceId: "own",
		name: id,
		remote: null,
		folder: true,
		createdAt: 10,
		removedAt: null,
		clone: true,
		walked: false,
		...more,
	} as Moving;
}

export function schedule(id: string, more: Partial<Schedule> = {}): Schedule {
	const row = { id, flow: "f", inputs: {}, cron: "0 6 * * *", enabled: true };
	return { ...row, ...more } as Schedule;
}

/**
 * This computer ("me", of "ada") and its home Host ("host", where its
 * Person is "ada-there" with the personal Space "theirs"), in memory. Its
 * own Personal is "own". `log` has what changed, in order.
 */
export function inMemoryHome() {
	const log: string[] = [];
	const record = inMemoryMembershipRecord();
	const batches = inMemoryBatches();
	const personalSpaces = inMemoryPersonalSpaces({
		personalId: "own",
		existing: new Set(["own"]),
	});
	const copies = inMemoryDeviceCopies();
	const databaseCopy = inMemoryDatabaseCopy();
	const wait = inMemoryWait(async () => world.onSleep());
	const pairedDevices = inMemoryPairedDevices();
	const homeRow: HostRow = {
		hostId: "host",
		name: "Studio",
		addresses: [],
		certificate: null,
		fingerprint: null,
		role: "home",
		personId: "ada-there",
		keyStore: "file",
		createdAt: 0,
		revokedAt: null,
	} as HostRow;
	const asked: PersonalMergeInput[] = [];
	const merged: { from: string; to: string; persons: unknown }[] = [];
	const planned: unknown[] = [];
	const marked = new Set<string>();
	const plans: Plan[] = [];
	const forgotten: string[] = [];
	const opened: string[] = [];
	const inStep: (readonly string[])[] = [];
	const pushedAsked: unknown[] = [];
	const named: string[] = [];

	const world = {
		log,
		record,
		batches,
		personalSpaces,
		copies,
		databaseCopy,
		wait,
		pairedDevices,
		/** Every row of `host_link`, revoked ones too. */
		hosts: [homeRow] as HostRow[],
		/** The Hosts whose link answers now. */
		online: new Set(["host"]),
		/** The Hosts this computer has a link to. */
		linked: new Set(["host"]),
		listed: [{ id: "theirs", name: "Personal on Studio", personal: true }],
		/** The Host that lists them. */
		listedBy: "host",
		/** The Spaces a Host keeps. */
		keptBy: new Map([["theirs", "host"]]),
		projects: [moving("p1")] as Moving[],
		/** The notes on the Flows pages, by Project. */
		notes: new Map<string, string[]>(),
		runs: [] as Run[],
		schedules: new Map<string, Schedule[]>(),
		/** The Host's copy of the schedules, as the documents last synced (`sync`). */
		hostSchedules: new Map<string, Schedule[]>(),
		answer: (input: PersonalMergeInput): PersonalMerge => ({
			spaceId: "theirs",
			projectMap: Object.fromEntries(input.projects.map((p) => [p.id, p.id])),
			personMap: { ada: "ada-there" },
			elsewhere: [],
		}),
		/** A call on the Host fails with this. */
		callFails: null as Error | null,
		/** Runs under the hold of a move, before its plan. */
		underHold: async () => {},
		/** The batch of a move fails with this: no row of it lands. */
		batchFails: null as Error | null,
		/** Runs at each wait. */
		onSleep: () => {},
		synced: true,
		pushed: true,
		openFails: null as Error | null,
		asked,
		merged,
		planned,
		plans,
		forgotten,
		opened,
		inStep,
		pushedAsked,
		named,
		leave,
		/** Personal is merged with the Host's: what this computer has when it leaves. */
		joined() {
			personalSpaces.setPersonalId("theirs");
			personalSpaces.existing.clear();
			personalSpaces.existing.add("theirs");
			world.projects = [moving("p1", { spaceId: "theirs" })];
		},
		/**
		 * The documents sync with the Host, as a link with access does: those of
		 * the Projects in a Space that the Host keeps. What this computer wrote
		 * goes to the Host, a pause too.
		 */
		sync(hostId = "host") {
			const link = world.hosts.find((h) => h.hostId === hostId);
			if (!link || link.revokedAt !== null) return;
			for (const p of world.projects) {
				if (world.keptBy.get(p.spaceId) !== hostId) continue;
				const schedules = world.schedules.get(p.id);
				if (schedules) world.hostSchedules.set(p.id, schedules);
			}
		},
		/** The Host's access removed, as the link marks it. */
		revoke(hostId = "host") {
			world.hosts = world.hosts.map((h) =>
				h.hostId === hostId ? { ...h, revokedAt: 1 } : h,
			);
		},
		run(id: string, more: Partial<Run> = {}) {
			world.runs.push({
				id,
				spaceId: "own",
				projectId: "p1",
				status: "finished",
				walker: "me",
				...more,
			});
		},
	};

	/** The Host takes the leave. */
	async function leave() {
		log.push("told");
		return undefined;
	}

	function linkTo(hostId: string) {
		if (!world.linked.has(hostId)) return undefined;
		return {
			hostId,
			state: () => ({
				status: world.online.has(hostId) ? "online" : "offline",
			}),
			async call(use: (client: unknown) => Promise<unknown>) {
				if (world.callFails) throw world.callFails;
				return use({
					sync: {
						async mergePersonal(input: PersonalMergeInput) {
							asked.push(input);
							return world.answer(input);
						},
					},
					link: { leave: () => world.leave() },
				});
			},
			async inStep(names: readonly string[]) {
				inStep.push(names);
				return world.synced;
			},
		};
	}

	const engine = {
		space: (spaceId: string) => ({
			async projectRuns() {
				const of = new Map<
					string,
					{ total: number; statuses: Record<string, number> }
				>();
				for (const run of world.runs) {
					if (run.spaceId !== spaceId) continue;
					const counts = of.get(run.projectId) ?? { total: 0, statuses: {} };
					counts.total++;
					counts.statuses[run.status] = (counts.statuses[run.status] ?? 0) + 1;
					of.set(run.projectId, counts);
				}
				return of;
			},
			listRuns: async ({ statuses }: { statuses: string[] }) =>
				world.runs
					.filter((r) => r.spaceId === spaceId && statuses.includes(r.status))
					.map((r) => ({ ...r, walker: { id: r.walker } })),
		}),
		/** As the engine's: the plan under the hold, the schedules, then one batch. */
		async moveProjects(move: ProjectsMove) {
			await world.underHold();
			const plan = await move.plan();
			plans.push(plan);
			const sources = Object.keys(plan.projects);
			let changed = 0;
			for (const id of sources) {
				const before = world.schedules.get(id) ?? [];
				const after = before.map((s) => plan.schedule?.(s) ?? s);
				changed += after.filter((s, i) => s !== before[i]).length;
				world.schedules.set(id, after);
			}
			const moves = world.runs.filter(
				(r) =>
					r.spaceId === move.from &&
					sources.includes(r.projectId) &&
					(!plan.ownRunsOnly || r.walker === "me"),
			);
			const done = {
				projects: sources,
				runIds: moves.map((r) => r.id),
				schedules: changed,
			};
			const batch = await move.statements?.(done);
			if (world.batchFails) throw world.batchFails;
			// As the engine's batch: a Project that is left fails it.
			const left = world.projects.some(
				(p) => p.spaceId === move.from && !sources.includes(p.id),
			);
			if (plan.empties && left) throw new Error("A project is left.");
			runInMemory((batch ?? []) as RowBatch);
			for (const run of moves) {
				const to = plan.projects[run.projectId];
				if (!to) continue;
				run.spaceId = to.spaceId;
				run.projectId = to.projectId;
			}
			world.projects = world.projects.map((p) => {
				const to = plan.projects[p.id];
				return to && p.spaceId === move.from
					? { ...p, id: to.projectId, spaceId: to.spaceId }
					: p;
			});
			log.push("moved");
			return done;
		},
		async forgetSpace(spaceId: string) {
			if (world.projects.some((p) => p.spaceId === spaceId)) return false;
			forgotten.push(spaceId);
			return true;
		},
		flows: {
			schedules: async (id: string) => ({
				schedules: world.schedules.get(id) ?? [],
			}),
			async saveSchedules(id: string, schedules: Schedule[]) {
				world.schedules.set(id, schedules);
			},
			async planMerge(...args: unknown[]) {
				planned.push(args);
				return { flows: { hello: "hello-2" } };
			},
			async note(id: string, marker: string, notice: { message: string }) {
				const notes = world.notes.get(id) ?? [];
				if (marked.has(`${id} ${marker}`)) return;
				marked.add(`${id} ${marker}`);
				world.notes.set(id, [...notes, notice.message]);
			},
			async merge(from: string, to: string, options: { persons: unknown }) {
				merged.push({ from, to, persons: options.persons });
			},
		},
		exchange: {
			async pushed(...args: unknown[]) {
				pushedAsked.push(args);
				return world.pushed;
			},
		},
		hostSpaces: {
			listed: async (hostId: string) =>
				hostId === world.listedBy ? world.listed : [],
			hostOf: async (spaceId: string) => world.keptBy.get(spaceId) ?? null,
			async keeper(spaceId: string) {
				const hostId = world.keptBy.get(spaceId);
				if (hostId === undefined) return null;
				const link = world.hosts.find((h) => h.hostId === hostId) ?? null;
				return { hostId, link };
			},
			named: (spaceId: string, name: string) =>
				(
					inMemoryBatch(() => named.push(`${spaceId}: ${name}`)) as unknown as [
						() => void,
					]
				)[0],
		},
		projects: {
			ofSpace: async (spaceId: string) =>
				world.projects.filter((p) => p.spaceId === spaceId),
		},
	};

	const deps = {
		engine,
		links: {
			get: linkTo,
			async add(row: HostRow) {
				log.push(`added ${row.hostId}${row.revokedAt === null ? "" : " gone"}`);
			},
		},
		hostLinks: {
			home: async () =>
				world.hosts.find((h) => h.role === "home" && h.revokedAt === null) ??
				null,
			get: async (hostId: string) =>
				world.hosts.find((h) => h.hostId === hostId) ?? null,
			list: async () => world.hosts,
			async revoked(hostId: string) {
				log.push(`revoked ${hostId}`);
				world.revoke(hostId);
			},
		},
		keys: {
			async delete(hostId: string) {
				log.push(`key ${hostId}`);
			},
		},
		copies,
		spaces: {
			async open(spaceId: string) {
				if (world.openFails) throw world.openFails;
				opened.push(spaceId);
				log.push(`opened ${spaceId}`);
			},
		},
		flows: {
			open: async (id: string) => ({
				current: { name: `${id}/current` },
				history: { name: `${id}/history` },
			}),
		},
		self: { id: "me", name: "Laptop" },
		ownerId: "ada",
		dataDir: "/data",
		record,
		personalSpaces,
		pairedDevices,
		databaseCopy,
		batches,
		wait,
		ids: inMemoryIds("fresh"),
		engineKernel: inMemoryEngineKernel(
			undefined,
			(error) => error instanceof HostDown,
		),
		isNotPaired: (error: unknown) => error instanceof NotKnown,
		listedWaitMs: 200,
		pushWaitMs: 0,
		syncWaitMs: 0,
	} as unknown as HomeMembershipDeps;

	return { deps, world };
}
