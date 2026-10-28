import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { personalSpaceId, spacesOf } from "@nightshift/auth";
import {
	event,
	hostLink as hostLinkTable,
	hostSpace,
	keptVariable,
	organization,
	run as runTable,
	spaceMerge,
	spaceSplit,
	user,
} from "@nightshift/db/schema";
import {
	createSandbox,
	type Sandbox,
	seedFlows,
	waitFor,
} from "@nightshift/engine/testing";
import type { Flow } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { ORPCError } from "@orpc/client";
import { eq } from "drizzle-orm";
import type { HostClient } from "../contract";
import { createDeviceExchange } from "../exchange";
import { createHostLinks, type Link } from "../links";
import { httpsLink } from "../links/link";
import { type PairedReplicas, pairedReplicas } from "../testing";
import { LEAVE_WORDS, leaveHomeHost } from "./leave";
import { createPersonalMerge } from "./personal-merge";
import {
	createPersonalSplit,
	type PersonalSplitDeps,
	SPLIT_WORDS,
} from "./split";

/**
 * Leaving keeps a copy (ADR 1): B (the Device) merged its Personal into
 * A's (its home Host), then leaves A. B gets a personal Space of its own
 * again with what it worked on; A keeps everything. A and B have their
 * own Persons, as the author's laptop and Host do.
 */

let a: Sandbox;
let b: Sandbox;
let paired: PairedReplicas;
/** B's own Person. A knows them as `paired.personId`. */
let localPerson: string;
let periods: { stop(): Promise<void> }[];

beforeEach(async () => {
	[a, b] = await Promise.all([createSandbox(), createSandbox()]);
	paired = await pairedReplicas(a, b);
	const [local] = await b.db.select().from(user);
	localPerson = local?.id as string;
	periods = [];
});
afterEach(async () => {
	for (const period of periods) await period.stop();
	await Promise.all([a.cleanup(), b.cleanup()]);
});

const quickFlow = {
	version: 7,
	inputs: [],
	outputs: [],
	start: "hello",
	nodes: [
		{
			id: "hello",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo hello",
			output: "text",
		},
	],
	edges: [],
} as Flow;

const gateFlow = {
	...quickFlow,
	start: "ship",
	nodes: [
		{
			id: "ship",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "Ship it?",
			options: [{ name: "approve" }, { name: "reject" }],
			by: "person",
			decider: "typesafe",
		},
	],
} as Flow;

/** A link of B to A in memory. `refuse`: A no longer knows B's key. `down`: A does not answer. */
function linkToA(
	options: {
		push?: boolean;
		onRevoked?: () => void;
		refuse?: () => boolean;
		down?: () => boolean;
	} = {},
) {
	const memory: HostClient = paired.memory.client(paired.key);
	const gate = (): void => {
		if (options.down?.()) throw new TypeError("fetch failed");
		if (options.refuse?.()) throw new ORPCError("UNAUTHORIZED");
	};
	const client: HostClient = {
		...memory,
		link: {
			...memory.link,
			hello: async (...args: Parameters<HostClient["link"]["hello"]>) => {
				gate();
				return memory.link.hello(...args);
			},
			heartbeat: async (
				...args: Parameters<HostClient["link"]["heartbeat"]>
			) => {
				gate();
				return memory.link.heartbeat(...args);
			},
		},
	};
	const link = httpsLink({
		link: {
			hostId: paired.hostId,
			name: "A",
			addresses: ["memory"],
			certificate: null,
			fingerprint: null,
			role: "home",
			personId: paired.personId,
			keyStore: "file",
			createdAt: 0,
			revokedAt: null,
		},
		key: "memory",
		clientFor: () => client,
		heartbeatMs: 20,
		firstBackoffMs: 5,
		maxBackoffMs: 20,
		streamBackoff: { firstMs: 5, maxMs: 20 },
		...(options.onRevoked ? { onRevoked: options.onRevoked } : {}),
	});
	const detach =
		options.push === false
			? () => {}
			: createDeviceExchange({
					engine: paired.device,
					hostId: paired.hostId,
					selfId: b.deviceId,
					idleMs: 100,
				}).attach(link);
	const period = {
		link,
		async stop() {
			detach();
			await link.close();
		},
	};
	periods.push(period);
	return period;
}

async function ready(link: Link) {
	await waitFor(async () => link.state().status === "online", {
		label: "B's link online",
		timeoutMs: 5_000,
	});
}

function splitter(extra: Partial<PersonalSplitDeps> = {}) {
	return createPersonalSplit({
		db: b.db,
		engine: paired.device,
		hostLinks: createHostLinks(b.db),
		spaces: paired.documents,
		flows: paired.flows,
		self: { id: b.deviceId, name: "B" },
		ownerId: localPerson,
		dataDir: b.dataDir,
		...extra,
	});
}

async function runOf(sandbox: Sandbox, runId: string) {
	const [row] = await sandbox.db
		.select({
			spaceId: runTable.spaceId,
			projectId: runTable.projectId,
			startedBy: runTable.startedBy,
		})
		.from(runTable)
		.where(eq(runTable.id, runId));
	return row ?? null;
}

/**
 * B's Personal with one project and one run that finished, with a flow
 * that has a schedule, merged into A's: what B has before it leaves.
 */
async function mergedIntoA() {
	const space = paired.device.space(b.spaceId);
	const added = await space.addProject({ repoPath: b.repoPath });
	await seedFlows(space, added.id, { hello: quickFlow }, [
		{
			id: "nightly",
			flow: "hello",
			inputs: {},
			cron: "0 22 * * *",
			enabled: true,
		},
	]);
	// A second save: the flow has history.
	await space.saveFlow(added.id, "hello", {
		...quickFlow,
		nodes: [{ ...quickFlow.nodes[0], command: "echo again" }],
	} as Flow);
	const started = await space.startRun({
		projectId: added.id,
		flow: quickFlow,
	});
	await waitFor(
		async () => (await space.getRun(started.id)).status === "finished",
		{ label: "B's run finished", timeoutMs: 10_000 },
	);
	const { link } = linkToA();
	await ready(link);
	const merged = await createPersonalMerge({
		db: b.db,
		engine: paired.device,
		links: { get: (hostId) => (hostId === paired.hostId ? link : undefined) },
		hostLinks: createHostLinks(b.db),
		spaces: paired.documents,
		flows: paired.flows,
		self: { id: b.deviceId, name: "B" },
		ownerId: localPerson,
		dataDir: b.dataDir,
		syncWaitMs: 500,
		pushWaitMs: 5_000,
		pollMs: 20,
	}).run();
	expect(merged.state).toBe("pushed");
	expect(await personalSpaceId(b.db, localPerson)).toBe(a.spaceId);
	return { projectId: added.id, runId: started.id };
}

/** A run of the project that A walked, as B pulled it. */
async function walkedByA(projectId: string) {
	await b.db.insert(runTable).values({
		id: "run-walked-by-a",
		spaceId: a.spaceId,
		projectId,
		flow: "{}",
		title: "On A",
		worktreePath: "/a/worktree",
		branch: "on-a",
		baseRef: "main",
		walkerId: a.deviceId,
		startedBy: paired.personId,
	});
	await b.db.insert(event).values({
		spaceId: a.spaceId,
		runId: "run-walked-by-a",
		type: "RunStarted",
		payload: JSON.stringify({
			projectId,
			flowName: "hello",
			title: "On A",
			start: "hello",
			startedBy: paired.personId,
		}),
		walkerId: a.deviceId,
		walkerSeq: 1,
	});
}

/** B has no access to A any more, as its link marks it. */
const revoke = () => createHostLinks(b.db).revoked(paired.hostId);

describe("leaving the home Host keeps a copy", () => {
	test("the author's shape: Personal is B's own again, with its project, flows, schedules, kept variables and runs", async () => {
		const { projectId, runId } = await mergedIntoA();
		expect(localPerson).not.toBe(paired.personId);
		await walkedByA(projectId);
		await b.db.insert(keptVariable).values({
			spaceId: a.spaceId,
			projectId,
			flowName: "hello",
			name: "count",
			value: "3",
			runId,
			stepId: "hello",
		});
		const onlyOnA = await paired.host
			.space(a.spaceId)
			.addProject({ repoPath: a.repoPath, name: "Only on A" });
		await paired.projectOnDevice(onlyOnA.id);
		await revoke();

		const result = await splitter().run();

		expect(result).toMatchObject({
			state: "done",
			projects: 1,
			runs: 1,
			unpinned: 0,
		});
		const own = result?.spaceId as string;
		expect(own).not.toBe(a.spaceId);
		// One personal Space, B's own, named Personal: A's is gone from the switcher.
		expect(await personalSpaceId(b.db, localPerson)).toBe(own);
		expect(await spacesOf(b.db, localPerson)).toEqual([
			{ id: own, name: "Personal", personal: true, role: "owner" },
		]);
		const projects = await paired.device.space(own).listProjects();
		expect(projects.map((p) => [p.id, p.repoPath !== null])).toEqual([
			[projectId, true],
		]);
		// The run B walked, started by B's own Person again.
		expect(await runOf(b, runId)).toEqual({
			spaceId: own,
			projectId,
			startedBy: localPerson,
		});
		expect((await paired.device.space(own).getRun(runId)).status).toBe(
			"finished",
		);
		// The run A walked stays with A's Space.
		expect(await runOf(b, "run-walked-by-a")).toMatchObject({
			spaceId: a.spaceId,
		});
		const runs = await paired.device.space(own).listRuns();
		expect(runs.map((r) => r.id)).toEqual([runId]);
		// The flow with its history, and its schedule.
		const flows = await paired.device.space(own).listFlows(projectId);
		expect(flows.map((f) => f.name)).toEqual(["hello"]);
		const revisions = await paired.device
			.space(own)
			.listFlowRevisions(projectId, "hello");
		expect(revisions.length).toBeGreaterThanOrEqual(2);
		const schedules = await paired.device.space(own).listSchedules(projectId);
		expect(schedules.schedules.map((s) => s.id)).toEqual(["nightly"]);
		const [kept] = await b.db
			.select()
			.from(keptVariable)
			.where(eq(keptVariable.projectId, projectId));
		expect(kept).toMatchObject({ spaceId: own, value: "3" });
		// A's Space stays here, as A's, with what did not come along.
		const [theirs] = await b.db
			.select()
			.from(organization)
			.where(eq(organization.id, a.spaceId));
		expect(theirs).toMatchObject({
			name: "Personal on A",
			personal: false,
		});
		const [listed] = await b.db
			.select()
			.from(hostSpace)
			.where(eq(hostSpace.spaceId, a.spaceId));
		expect(listed?.name).toBe("Personal on A");
		// A keeps everything.
		const onA = await paired.host.space(a.spaceId).listProjects();
		expect(onA.map((p) => p.id).sort()).toEqual([projectId, onlyOnA.id].sort());
		expect(await runOf(a, runId)).toMatchObject({ spaceId: a.spaceId });
		// The copy of the database before it.
		const backups = await readdir(join(b.dataDir, "backups"));
		expect(
			backups.filter((f) => f.startsWith("before-leaving-host-")),
		).toHaveLength(1);
	});

	test("a schedule that names another device is paused on B after the split and names no device; turned on, it has a next start; one that names B stays", async () => {
		const { projectId } = await mergedIntoA();
		const flows = await paired.flows.open(projectId);
		await flows.current.change(() => {
			flows.schedules.set("on-c", {
				id: "on-c",
				flow: "hello",
				inputs: {},
				cron: "0 6 * * *",
				enabled: true,
				device: "C",
				person: paired.personId,
			});
		});
		await revoke();

		const result = await splitter().run();

		expect(result).toMatchObject({ state: "done", unpinned: 1 });
		const own = result?.spaceId as string;
		const { schedules } = await paired.device
			.space(own)
			.listSchedules(projectId);
		const byId = new Map(schedules.map((s) => [s.id, s]));
		expect(byId.get("nightly")).toMatchObject({ device: "B", enabled: true });
		// A still fires it on C: B does not run it a second time.
		expect(byId.get("on-c")).toMatchObject({
			enabled: false,
			nextAt: null,
			cron: "0 6 * * *",
		});
		expect(byId.get("on-c")?.device).toBeUndefined();
		expect(byId.get("on-c")?.person).toBeUndefined();
		expect(await splitter().of(a.spaceId)).toMatchObject({ unpinned: 1 });

		await flows.current.change(() => {
			const value = flows.schedules.get("on-c") as Record<string, unknown>;
			flows.schedules.set("on-c", { ...value, enabled: true });
		});
		const turnedOn = await paired.device.space(own).listSchedules(projectId);
		expect(
			turnedOn.schedules.find((s) => s.id === "on-c")?.nextAt,
		).not.toBeNull();
	});

	test("a split that is done does not run again", async () => {
		await mergedIntoA();
		await revoke();
		const first = await splitter().run();

		expect(await splitter().run()).toBeNull();
		expect(await b.db.select().from(spaceSplit)).toHaveLength(1);
		expect(await personalSpaceId(b.db, localPerson)).toBe(
			first?.spaceId ?? "none",
		);
	});

	test("two asks at once split once, and both see the same Space", async () => {
		await mergedIntoA();
		await revoke();
		const split = splitter();

		const [first, second] = await Promise.all([split.run(), split.run()]);

		expect(first?.state).toBe("done");
		expect(second).toBeNull();
		expect(await split.of(a.spaceId)).toEqual(first);
		expect(await b.db.select().from(spaceSplit)).toHaveLength(1);
	});

	test("nothing splits while B still has access to A", async () => {
		await mergedIntoA();

		expect(await splitter().run()).toBeNull();
		expect(await personalSpaceId(b.db, localPerson)).toBe(a.spaceId);
		expect(await b.db.select().from(spaceSplit)).toEqual([]);
	});

	test("a Personal of B's own, never merged, stays as it is", async () => {
		await revoke();

		expect(await splitter().run()).toBeNull();
		expect(await personalSpaceId(b.db, localPerson)).toBe(b.spaceId);
	});

	test("a split stopped after each state goes on to the same end", async () => {
		const { runId } = await mergedIntoA();
		await revoke();
		const state = async () =>
			(await b.db.select().from(spaceSplit))[0]?.state ?? null;

		// planned: the batch is never made.
		await expect(
			splitter({
				moveStatements: () => {
					throw new Error("Stopped before the batch.");
				},
			}).run(),
		).rejects.toThrow("Stopped before the batch.");
		expect(await state()).toBe("planned");
		expect(await runOf(b, runId)).toMatchObject({ spaceId: a.spaceId });
		expect(await personalSpaceId(b.db, localPerson)).toBe(a.spaceId);

		// moved: the new Space's document does not open.
		let fail = true;
		const documents = paired.documents;
		await expect(
			splitter({
				spaces: {
					open: (spaceId) => {
						if (fail)
							return Promise.reject(new Error("Stopped after the batch."));
						return documents.open(spaceId);
					},
				},
			}).run(),
		).rejects.toThrow("Stopped after the batch.");
		expect(await state()).toBe("moved");
		const [row] = await b.db.select().from(spaceSplit);
		expect(await runOf(b, runId)).toMatchObject({ spaceId: row?.toSpace });

		fail = false;
		const done = await splitter().run();
		expect(done).toMatchObject({
			state: "done",
			spaceId: row?.toSpace,
			projects: 1,
			runs: 1,
		});
		expect(await state()).toBe("done");
		const projects = await paired.device
			.space(row?.toSpace as string)
			.listProjects();
		expect(projects).toHaveLength(1);
		// One copy of the database: the split made it once.
		const backups = await readdir(join(b.dataDir, "backups"));
		expect(
			backups.filter((f) => f.startsWith("before-leaving-host-")),
		).toHaveLength(1);
	});

	test("a run B walks that is not done holds the split back, until it is done", async () => {
		const { projectId } = await mergedIntoA();
		const space = paired.device.space(a.spaceId);
		const waiting = await space.startRun({ projectId, flow: gateFlow });
		await waitFor(
			async () => (await space.getRun(waiting.id)).status === "waiting",
			{ label: "B's run waits", timeoutMs: 10_000 },
		);
		await revoke();

		const refused = splitter().run();
		await expect(refused).rejects.toBeInstanceOf(Refusal);
		await expect(refused).rejects.toThrow(SPLIT_WORDS.notDone(1));
		await expect(splitter().check()).rejects.toThrow(SPLIT_WORDS.notDone(1));
		expect(await b.db.select().from(spaceSplit)).toEqual([]);

		await space.stopRun(waiting.id);
		await waitFor(
			async () => (await space.getRun(waiting.id)).status !== "waiting",
			{ label: "B's run stopped", timeoutMs: 10_000 },
		);
		const result = await splitter().run();
		expect(result?.runs).toBe(2);
	});

	test("a merge that never moved a row ends when B leaves", async () => {
		await b.db.insert(spaceMerge).values({
			fromSpace: b.spaceId,
			hostId: paired.hostId,
			personId: localPerson,
			state: "mapped",
			backup: "/nowhere",
		});
		await revoke();

		expect(await splitter().run()).toBeNull();
		expect(await b.db.select().from(spaceMerge)).toEqual([]);
	});

	for (const when of ["online", "offline"] as const) {
		test(`A removes B's access while B is ${when}: B splits Personal off when it learns it`, async () => {
			const { runId } = await mergedIntoA();
			let refused = false;
			let down = false;
			const split = splitter();
			const learned: Promise<unknown>[] = [];
			const hostLinks = createHostLinks(b.db);
			const { link } = linkToA({
				push: false,
				refuse: () => refused,
				down: () => down,
				// What B's links do when A refuses the key (`createDeviceLinks`, `startDevices`).
				onRevoked: () => {
					learned.push(
						hostLinks.revoked(paired.hostId).then(() => split.run()),
					);
				},
			});
			await ready(link);
			if (when === "offline") {
				down = true;
				await waitFor(async () => link.state().status === "offline", {
					label: "B offline",
					timeoutMs: 5_000,
				});
			}
			refused = true;
			// Nothing changes before B learns it.
			expect(await personalSpaceId(b.db, localPerson)).toBe(a.spaceId);
			down = false;

			await waitFor(async () => link.state().status === "revoked", {
				label: "B learns it",
				timeoutMs: 5_000,
			});
			await Promise.all(learned);

			const own = await personalSpaceId(b.db, localPerson);
			expect(own).not.toBe(a.spaceId);
			expect(await runOf(b, runId)).toMatchObject({
				spaceId: own,
				startedBy: localPerson,
			});
		});
	}

	test("keepFinishing splits Personal off at start once B left, and waits for runs", async () => {
		await mergedIntoA();
		await revoke();
		const stop = new AbortController();
		splitter().keepFinishing(stop.signal, 20);
		try {
			await waitFor(
				async () => (await b.db.select().from(spaceSplit))[0]?.state === "done",
				{ label: "the split is done", timeoutMs: 5_000 },
			);
		} finally {
			stop.abort();
		}
		expect(await personalSpaceId(b.db, localPerson)).not.toBe(a.spaceId);
	});
});

describe("nightshift leave", () => {
	/** B leaves A over `link`, with its own split. */
	async function leave(link: Link | undefined) {
		const hostLinks = createHostLinks(b.db);
		const deleted: string[] = [];
		const kept: unknown[][] = [];
		const stopped: string[] = [];
		const result = await leaveHomeHost({
			hostLinks,
			links: {
				get: () => link,
				add: async (left) => {
					if (left.revokedAt !== null) stopped.push(left.hostId);
				},
			},
			keys: {
				delete: async (hostId) => {
					deleted.push(hostId);
				},
			},
			copies: {
				keep: async (devices) => {
					kept.push([...devices]);
					return [];
				},
			},
			split: splitter(),
		});
		return { result, deleted, kept, stopped };
	}

	const accessOnA = async () =>
		(await paired.host.devices.get(b.deviceId))?.revokedAt ?? null;

	test("A removes B's access, and B keeps a copy of its Personal", async () => {
		const { runId } = await mergedIntoA();
		const { link } = linkToA({ push: false });
		await ready(link);

		const { result, deleted, kept, stopped } = await leave(link);

		expect(result).toMatchObject({
			host: { id: paired.hostId, name: "A" },
			told: true,
			split: { state: "done", projects: 1, runs: 1 },
			waiting: null,
		});
		expect(await accessOnA()).not.toBeNull();
		const [row] = await b.db
			.select()
			.from(hostLinkTable)
			.where(eq(hostLinkTable.hostId, paired.hostId));
		expect(row?.revokedAt).not.toBeNull();
		expect(deleted).toEqual([paired.hostId]);
		expect(stopped).toEqual([paired.hostId]);
		expect(kept).toEqual([[]]);
		expect(await runOf(b, runId)).toMatchObject({
			spaceId: result.split?.spaceId,
			startedBy: localPerson,
		});
	});

	test("a Host that does not answer does not hold B back", async () => {
		await mergedIntoA();
		const { link } = linkToA({ push: false, down: () => true });

		const { result } = await leave(link);

		expect(result).toMatchObject({ told: false, split: { state: "done" } });
		expect(await accessOnA()).toBeNull();
	});

	test("an older Host without leave: B leaves on its own", async () => {
		await mergedIntoA();
		const { link } = linkToA({ push: false });
		await ready(link);
		const older: Link = {
			...link,
			call: () =>
				Promise.reject(new ORPCError("NOT_FOUND", { message: "Not found" })),
		};

		const { result } = await leave(older);

		expect(result.told).toBe(false);
		expect(result.split?.state).toBe("done");
	});

	test("a Personal that never merged stays as it is", async () => {
		const { link } = linkToA({ push: false });
		await ready(link);

		const { result } = await leave(link);

		expect(result).toMatchObject({ told: true, split: null, waiting: null });
		expect(await personalSpaceId(b.db, localPerson)).toBe(b.spaceId);
	});

	test("a run B walks that is not done refuses the leave before anything changes", async () => {
		const { projectId } = await mergedIntoA();
		const space = paired.device.space(a.spaceId);
		const waiting = await space.startRun({ projectId, flow: gateFlow });
		await waitFor(
			async () => (await space.getRun(waiting.id)).status === "waiting",
			{ label: "B's run waits", timeoutMs: 10_000 },
		);
		const { link } = linkToA({ push: false });
		await ready(link);

		await expect(leave(link)).rejects.toThrow(SPLIT_WORDS.notDone(1));
		expect(await accessOnA()).toBeNull();
		const [row] = await b.db
			.select()
			.from(hostLinkTable)
			.where(eq(hostLinkTable.hostId, paired.hostId));
		expect(row?.revokedAt).toBeNull();
	});

	test("without a home Host, there is nothing to leave", async () => {
		await revoke();

		await expect(leave(undefined)).rejects.toThrow(LEAVE_WORDS.noHome);
	});
});
