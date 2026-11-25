import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { testSpaces } from "@nightshift/auth/testing";
import {
	event,
	hostLink as hostLinkTable,
	hostSpace,
	keptVariable,
	member,
	organization,
	runCommand,
	run as runTable,
	spaceMerge,
	spaceSplit,
	user,
} from "@nightshift/db/schema";
import { createFlowDocuments, NIGHT_SHIFT } from "@nightshift/engine";
import {
	createProjectFlows,
	createSandbox,
	mustGit,
	type Sandbox,
	seedFlows,
	waitFor,
} from "@nightshift/engine/testing";
import type { Flow, Schedule } from "@nightshift/flows";
import { FLOW_VERSION } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { asDate } from "@nightshift/time";
import { ORPCError } from "@orpc/client";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import type { HostClient } from "../../contract";
import { createDeviceExchange } from "../../exchange";
import { createHostLinks, type Link } from "../../links";
import { fromHost } from "../../links/from-host";
import { httpsLink } from "../../links/link";
import { type PairedReplicas, pairedReplicas } from "../../testing";
import { pausedHere } from "../../wire-peers-paused";
import { LEAVE_WORDS, SPLIT_WORDS } from "./domain/words";
import { type MembershipTestDeps, membershipOver } from "./test-support";

const personalSpaceId = (
	db: Parameters<typeof testSpaces>[0],
	personId: string,
) => testSpaces(db).personal.findPersonalSpace({ personId });
const spacesOf = (db: Parameters<typeof testSpaces>[0], personId: string) =>
	testSpaces(db).listSpaces({ personId });

/**
 * Leaving keeps a copy (ADR 1), through B's membership of A
 * (`HomeMembership`): B (the Device) merged its Personal into A's (its
 * home Host), then leaves A. B gets a personal Space of its own
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
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "hello",
	nodes: [
		{
			id: "hello",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo hello",
			stdout: "text",
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
		if (options.refuse?.()) {
			throw new ORPCError("UNAUTHORIZED", {
				data: { hostId: paired.hostId },
			});
		}
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

/** B's membership of A, with `link` as its link to A. */
function membershipOf(
	link: Link | undefined,
	extra: Partial<MembershipTestDeps> = {},
) {
	return membershipOver({
		db: b.db,
		engine: paired.device,
		links: {
			get: (hostId) => (hostId === paired.hostId ? link : undefined),
			add: async () => {},
		},
		hostLinks: createHostLinks(b.db),
		keys: { delete: async () => {} },
		copies: { keep: async () => [] },
		spaces: paired.documents,
		flows: paired.flows,
		self: { id: b.deviceId, name: "B" },
		ownerId: localPerson,
		dataDir: b.dataDir,
		syncWaitMs: 500,
		pushWaitMs: 5_000,
		pollMs: 20,
		...extra,
	});
}

/** B's membership without a link to A: A removed its access. */
function splitter(extra: Partial<MembershipTestDeps> = {}) {
	return membershipOf(undefined, extra);
}

/** The link that A removed: B's home Host. */
const home = { role: "home" } as const;

/** B's engine, with `before` called as a Space move puts its batch together. */
function beforeBatch(before: () => void): MembershipTestDeps["engine"] {
	return {
		...paired.device,
		moveProjects: (move) =>
			paired.device.moveProjects({
				...move,
				statements: async (moved) => {
					before();
					return (await move.statements?.(moved)) ?? [];
				},
			}),
	};
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
	const space = paired.device.space(b.spaceId, NIGHT_SHIFT);
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
	await space.flows.save(added.id, "hello", {
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
	const merged = await membershipOf(link).merge();
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

/** B's and A's flow documents of the project in step, as the link syncs them: A's schedules then. */
async function syncedSchedules(projectId: string) {
	const onA = createFlowDocuments({ db: a.db });
	const theirs = await onA.open(projectId);
	const ours = await paired.flows.open(projectId);
	for (const part of ["current", "history"] as const) {
		Y.applyUpdate(theirs[part].doc, Y.encodeStateAsUpdate(ours[part].doc));
		Y.applyUpdate(ours[part].doc, Y.encodeStateAsUpdate(theirs[part].doc));
	}
	await onA.flush();
	const { schedules } = await createProjectFlows({
		documents: onA,
		project: async () => ({ spaceId: "" }),
		deviceId: "a",
	}).schedules(projectId, { validate: false });
	await onA.flush();
	return schedules;
}

/** A gave B access again, as a join saves it: before its documents sync. */
async function joinAgain() {
	const links = createHostLinks(b.db);
	const left = await links.get(paired.hostId);
	if (!left) throw new Error("No link.");
	const { createdAt: _at, revokedAt: _gone, ...link } = left;
	await links.save(link);
}

/** B's project joined A's of the same remote; its flows wait for A's copy. */
async function waitingForHost(joined = false) {
	const remote = "https://github.com/acme/app.git";
	const repo = async (sandbox: Sandbox, name: string) => {
		const path = join(sandbox.root, name);
		await mkdir(path, { recursive: true });
		await mustGit(path, ["init", "-q", "-b", "main"]);
		await mustGit(path, ["remote", "add", "origin", remote]);
		return path;
	};
	let into = a.spaceId;
	if (joined) {
		into = "team";
		await a.db.insert(organization).values({
			id: into,
			name: "Team",
			slug: "team",
			createdAt: asDate(),
		});
		await a.db.insert(member).values({
			id: "in-team",
			organizationId: into,
			userId: paired.personId,
			role: "owner",
			createdAt: asDate(),
		});
	}
	const onA = await paired.host
		.space(into, NIGHT_SHIFT)
		.addProject({ repoPath: await repo(a, "app") });
	const space = paired.device.space(b.spaceId, NIGHT_SHIFT);
	const added = await space.addProject({ repoPath: await repo(b, "app") });
	await seedFlows(space, added.id, { hello: quickFlow }, [
		{
			id: "nightly",
			flow: "hello",
			inputs: {},
			cron: "0 22 * * *",
			enabled: true,
		},
	]);
	const { link } = linkToA();
	await ready(link);
	const waits: Link = { ...link, inStep: async () => false };
	if (joined) {
		// The Host's copies of the shared Space's rows.
		await paired.projectOnDevice(onA.id);
	}
	await expect(
		membershipOf(waits).merge({ join: joined ? [added.id] : [] }),
	).rejects.toBeInstanceOf(Refusal);
	expect((await b.db.select().from(spaceMerge))[0]?.state).toBe("moved");
	return { onA, source: added.id, link: waits };
}
const flowNames = async (projectId: string) =>
	Object.keys(
		await createProjectFlows({
			documents: paired.flows,
			project: async () => ({ spaceId: "" }),
			deviceId: b.deviceId,
		}).flows(projectId),
	);

describe("leaving and joining the same Host again", () => {
	/** B merged into A with its schedules on, in step with A, with a person on one. */
	async function merged() {
		const { projectId } = await mergedIntoA();
		const flows = paired.device.flows;
		const { schedules } = await flows.schedules(projectId, { validate: false });
		const [nightly] = schedules;
		if (!nightly) throw new Error("No schedule.");
		const before = [
			{ ...nightly, person: paired.personId },
			{ ...nightly, id: "off", enabled: false },
		];
		await docFlows().saveSchedules(projectId, before);
		expect(await syncedSchedules(projectId)).toEqual(before);
		return { projectId, before };
	}
	/** The same merge on a join, with a link that answers. */
	async function rejoined(extra: Partial<MembershipTestDeps> = {}) {
		await joinAgain();
		const { link } = linkToA();
		await ready(link);
		const membership = membershipOf(link, extra);
		const steps = [];
		for await (const step of membership.joined(paired.hostId)) {
			steps.push(step.kind);
		}
		return { steps, membership };
	}
	/** The schedules as the document of this computer has them. */
	const ownSchedules = async (projectId: string) =>
		(await paired.device.flows.schedules(projectId, { validate: false }))
			.schedules;
	const docFlows = () =>
		createProjectFlows({
			documents: paired.flows,
			project: async () => ({ spaceId: "" }),
			deviceId: b.deviceId,
		});

	/** The schedules as a person of this computer reads them. */
	async function shown(projectId: string): Promise<Schedule[]> {
		const own = await personalSpaceId(b.db, localPerson);
		const { schedules } = await paired.device
			.space(own as string, NIGHT_SHIFT)
			.listSchedules(projectId);
		return schedules.map(
			({ nextAt: _n, last: _l, deliveries: _d, issues: _i, ...schedule }) =>
				schedule as Schedule,
		);
	}

	test("the schedules that the leave paused here run on on the Host, with their person", async () => {
		const { projectId, before } = await merged();
		await revoke();
		expect((await splitter().revoked(home))?.unpinned).toBe(1);
		expect((await shown(projectId)).map((s) => s.enabled)).toEqual([
			false,
			false,
		]);
		expect(await ownSchedules(projectId)).toEqual(before);

		expect((await rejoined()).steps).toEqual(["merge-preview", "merged"]);

		expect(await syncedSchedules(projectId)).toEqual(before);
		expect(await shown(projectId)).toEqual(before);
		// A person who turns one off there keeps it off.
		const off = before.map((s) => ({ ...s, enabled: false }));
		await docFlows().saveSchedules(projectId, off);
		await revoke();
		await splitter().revoked(home);
		await rejoined();
		expect(await syncedSchedules(projectId)).toEqual(off);
	});

	test("a paused schedule does not fire here, and one that a person turns on does, also in another Space of this computer", async () => {
		const { projectId } = await merged();
		await revoke();
		await splitter().revoked(home);
		const own = (await personalSpaceId(b.db, localPerson)) as string;
		const here = pausedHere(b.db);
		expect([...(await here.of(projectId))].sort()).toEqual(["nightly", "off"]);
		await b.db.insert(organization).values({
			id: "other",
			name: "Other",
			slug: "other",
			createdAt: asDate(),
		});
		await paired.device.space(own, NIGHT_SHIFT).moveProject(projectId, "other");
		const space = paired.device.space("other", NIGHT_SHIFT);
		const { schedules } = await space.listSchedules(projectId);
		expect(schedules.map((s) => s.enabled)).toEqual([false, false]);
		// A save of the list as it reads changes nothing.
		await space.saveSchedules(projectId, schedules);
		expect((await ownSchedules(projectId))[0]?.enabled).toBe(true);
		await space.saveSchedules(
			projectId,
			schedules.map((s) => ({ ...s, enabled: s.id === "nightly" })),
		);
		expect((await here.of(projectId)).has("nightly")).toBe(false);
		expect((await space.listSchedules(projectId)).schedules[0]?.enabled).toBe(
			true,
		);
	});

	/** A person edits the schedules on the Host, as the writer `clientId` of its document. */
	async function editOnHost(
		projectId: string,
		edit: (schedules: Schedule[]) => Schedule[],
		clientId: number,
	) {
		const onA = createFlowDocuments({ db: a.db });
		(await onA.open(projectId)).current.doc.clientID = clientId;
		const flows = createProjectFlows({
			documents: onA,
			project: async () => ({ spaceId: "" }),
			deviceId: "a",
		});
		const { schedules } = await flows.schedules(projectId, { validate: false });
		await flows.saveSchedules(projectId, edit(schedules));
		await onA.flush();
	}
	const hostEdits: Record<string, (schedules: Schedule[]) => Schedule[]> = {
		off: (all) => all.map((s) => ({ ...s, enabled: false })),
		removed: (all) => all.filter((s) => s.id !== "nightly"),
		cron: (all) => all.map((s) => ({ ...s, cron: "0 5 * * *" })),
		nothing: (all) => all,
	};
	for (const [what, edit] of Object.entries(hostEdits)) {
		for (const wins of ["the Host", "this computer"] as const) {
			for (const state of ["done", "planned"] as const) {
				test(`what a person did on the Host stays (${what}, ${state} split, ${wins} writes last)`, async () => {
					const { projectId, before } = await merged();
					// Yjs gives the key to the higher writer of two at once.
					(await paired.flows.open(projectId)).current.doc.clientID =
						wins === "the Host" ? 1_000 : 900_000;
					await revoke();
					if (state === "done") {
						await splitter().revoked(home);
					} else {
						await splitter({
							engine: beforeBatch(() => {
								throw new Error("stop");
							}),
						})
							.revoked(home)
							.catch(() => {});
					}
					await editOnHost(projectId, edit, 500_000);
					if (state === "planned") {
						await joinAgain();
						await membershipOf(undefined).beforeJoin();
					}
					await rejoined();
					expect(await syncedSchedules(projectId)).toEqual(edit(before));
				});
			}
		}
	}

	test("what a person did here while apart goes along: a change, a removal, on and off again", async () => {
		const { projectId, before } = await merged();
		await revoke();
		await splitter().revoked(home);
		const edit = async (change: (all: Schedule[]) => Schedule[]) => {
			const own = (await personalSpaceId(b.db, localPerson)) as string;
			await paired.device
				.space(own, NIGHT_SHIFT)
				.saveSchedules(projectId, change(await shown(projectId)));
		};
		await edit((all) => all.map((s) => ({ ...s, cron: "0 5 * * *" })));
		await rejoined();
		const changed = before.map((s) => ({ ...s, cron: "0 5 * * *" }));
		expect(await syncedSchedules(projectId)).toEqual(changed);

		await revoke();
		await splitter().revoked(home);
		await edit((all) => all.map((s) => ({ ...s, enabled: s.id !== "off" })));
		await edit((all) => all.map((s) => ({ ...s, enabled: false })));
		await rejoined();
		expect((await syncedSchedules(projectId)).map((s) => s.enabled)).toEqual([
			false,
			false,
		]);

		await revoke();
		await splitter().revoked(home);
		await edit((all) => all.filter((s) => s.id === "off"));
		await rejoined();
		expect((await syncedSchedules(projectId)).map((s) => s.id)).toEqual([
			"off",
		]);
	});

	test("a split from before, whose pause is in the document, leaves it off", async () => {
		const { projectId, before } = await merged();
		await revoke();
		await splitter().revoked(home);
		await b.db.update(spaceSplit).set({ paused: null, waiting: null });
		const off = before.map(({ person: _person, ...s }) => ({
			...s,
			enabled: false,
		}));
		await docFlows().saveSchedules(projectId, off);
		await rejoined();
		expect(await syncedSchedules(projectId)).toEqual(off);
	});

	/** A leave whose batch failed: the split is planned, and its pauses are made. */
	async function plannedSplit() {
		const { projectId, before } = await merged();
		await revoke();
		await expect(
			splitter({
				engine: beforeBatch(() => {
					throw new Error("stop");
				}),
			}).revoked(home),
		).rejects.toThrow("stop");
		expect(await ownSchedules(projectId)).toEqual(before);
		return { projectId, before };
	}

	for (const step of ["beforeJoin", "beforeLinks"] as const) {
		test(`a split that moved no row is forgotten when the Host gave access back (${step}): Personal stays there, and its schedules stay on`, async () => {
			const { projectId, before } = await plannedSplit();
			const backups = await readdir(join(b.dataDir, "backups"));

			await joinAgain();
			await membershipOf(undefined)[step]();
			expect(await syncedSchedules(projectId)).toEqual(before);

			const { link } = linkToA();
			await ready(link);
			const membership = membershipOf(link);
			const steps = [];
			for await (const seen of membership.joined(paired.hostId)) {
				steps.push(seen);
			}
			expect(steps).toEqual([]);
			const stop = new AbortController();
			membership.keepFinishing(stop.signal, 20);
			await Bun.sleep(200);
			stop.abort();
			expect(await personalSpaceId(b.db, localPerson)).toBe(a.spaceId);
			expect(await b.db.select().from(spaceSplit)).toEqual([]);
			expect(await readdir(join(b.dataDir, "backups"))).toEqual(backups);
			expect(await syncedSchedules(projectId)).toEqual(before);
		});
	}

	test("a join as a guest does not forget a split that moved no row", async () => {
		await plannedSplit();
		await joinAgain();
		await b.db.update(hostLinkTable).set({ role: "guest" });
		await membershipOf(undefined).beforeJoin();
		expect((await b.db.select().from(spaceSplit))[0]?.state).toBe("done");
	});

	test("a split that moved no row goes on when the Host knows this computer as another Person now", async () => {
		await plannedSplit();
		await joinAgain();
		await b.db.update(hostLinkTable).set({ personId: "somebody" });
		await membershipOf(undefined).beforeJoin();
		expect((await b.db.select().from(spaceSplit))[0]?.state).toBe("done");
	});

	test("a split that moved its rows ends also when the Host gave access back", async () => {
		const { projectId, before } = await merged();
		await revoke();
		const error = console.error;
		console.error = () => {};
		await splitter({
			spaces: { open: () => Promise.reject(new Error("stop")) },
		})
			.revoked(home)
			.catch(() => {});
		console.error = error;
		expect((await b.db.select().from(spaceSplit))[0]?.state).toBe("moved");
		await joinAgain();
		await membershipOf(undefined).beforeJoin();
		expect((await b.db.select().from(spaceSplit))[0]?.state).toBe("done");
		// Personal is this computer's own: on here, they would fire here too.
		expect((await shown(projectId))[0]?.enabled).toBe(false);
		await rejoined();
		expect(await syncedSchedules(projectId)).toEqual(before);
	});

	test("a planned split off one Host ends before Personal goes to another one", async () => {
		await plannedSplit();
		const links = createHostLinks(b.db);
		const {
			createdAt: _at,
			revokedAt: _gone,
			...link
		} = (await links.get(paired.hostId)) as NonNullable<
			Awaited<ReturnType<typeof links.get>>
		>;
		await links.save({ ...link, hostId: "second", name: "Second" });
		await expect(membershipOf(undefined).merge()).rejects.toThrow();
		const [row] = await b.db.select().from(spaceSplit);
		expect(row?.state).toBe("done");
		expect(await personalSpaceId(b.db, localPerson)).toBe(
			row?.toSpace as string,
		);
	});

	for (const other of [
		{ hostId: "other" },
		{ hostPersonId: "other" },
		{ fromSpace: "other" },
	]) {
		test(`a schedule paused by another leave goes off to the Host: ${Object.keys(other)}`, async () => {
			const { projectId } = await merged();
			await revoke();
			await splitter().revoked(home);
			await b.db.update(spaceSplit).set(other);
			await rejoined();
			expect((await syncedSchedules(projectId)).map((s) => s.enabled)).toEqual([
				false,
				false,
			]);
		});
	}
});

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
		// Another repository, of A only: B's folder is a copy of A's own.
		const lab = join(a.root, "lab");
		await mkdir(lab, { recursive: true });
		await mustGit(lab, ["init", "-q", "-b", "main"]);
		const onlyOnA = await paired.host
			.space(a.spaceId, NIGHT_SHIFT)
			.addProject({ repoPath: lab, name: "Only on A" });
		await paired.projectOnDevice(onlyOnA.id);
		await revoke();

		const result = await splitter().revoked(home);

		expect(result).toMatchObject({
			state: "done",
			projects: 1,
			runs: 1,
			unpinned: 1,
		});
		const own = result?.spaceId as string;
		expect(own).not.toBe(a.spaceId);
		// One personal Space, B's own, named Personal: A's is gone from the switcher.
		expect(await personalSpaceId(b.db, localPerson)).toBe(own);
		expect(await spacesOf(b.db, localPerson)).toEqual([
			{ id: own, name: "Personal", personal: true, role: "owner" },
		]);
		const projects = await paired.device.space(own, NIGHT_SHIFT).listProjects();
		expect(projects.map((p) => [p.id, p.repoPath !== null])).toEqual([
			[projectId, true],
		]);
		// The run B walked, started by B's own Person again.
		expect(await runOf(b, runId)).toEqual({
			spaceId: own,
			projectId,
			startedBy: localPerson,
		});
		expect(
			(await paired.device.space(own, NIGHT_SHIFT).getRun(runId)).status,
		).toBe("finished");
		// The run A walked stays with A's Space.
		expect(await runOf(b, "run-walked-by-a")).toMatchObject({
			spaceId: a.spaceId,
		});
		const runs = await paired.device.space(own, NIGHT_SHIFT).listRuns();
		expect(runs.map((r) => r.id)).toEqual([runId]);
		// The flow with its history, and its schedule.
		const flows = await paired.device
			.space(own, NIGHT_SHIFT)
			.flows.list(projectId);
		expect(flows.map((f) => f.name)).toEqual(["hello"]);
		const revisions = await paired.device
			.space(own, NIGHT_SHIFT)
			.flows.revisions(projectId, "hello");
		expect(revisions.length).toBeGreaterThanOrEqual(2);
		const schedules = await paired.device
			.space(own, NIGHT_SHIFT)
			.listSchedules(projectId);
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
		const onA = await paired.host.space(a.spaceId, NIGHT_SHIFT).listProjects();
		expect(onA.map((p) => p.id).sort()).toEqual([projectId, onlyOnA.id].sort());
		expect(await runOf(a, runId)).toMatchObject({ spaceId: a.spaceId });
		// The copy of the database before it.
		const backups = await readdir(join(b.dataDir, "backups"));
		expect(
			backups.filter((f) => f.startsWith("before-leaving-host-")),
		).toHaveLength(1);
	});

	test("a leave ends with its split also when the store of the key fails, and the next start takes the rest", async () => {
		await mergedIntoA();
		const { link } = linkToA();
		await ready(link);
		const kept: unknown[] = [];
		const added: unknown[] = [];
		const deleted: string[] = [];
		let locked = true;
		const membership = membershipOf(link, {
			keys: {
				delete: async (hostId) => {
					if (locked) throw new Error("locked");
					deleted.push(hostId);
				},
			},
			copies: {
				keep: async (devices) => {
					kept.push(devices);
					return [];
				},
			},
			links: {
				get: () => link,
				add: async (left) => {
					added.push(left.revokedAt !== null);
				},
			},
		});
		const error = console.error;
		console.error = () => {};
		const result = await membership.leave().finally(() => {
			console.error = error;
		});
		expect(result).toMatchObject({ split: { state: "done" }, keyKept: true });
		expect(kept).toEqual([[]]);
		expect(added).toEqual([true]);

		locked = false;
		await membership.beforeLinks();
		expect(deleted).toEqual([paired.hostId]);
	});

	describe("flows that still wait for the Host", () => {
		const waiting = waitingForHost;
		const flowsIn = flowNames;

		test("come along when this computer leaves, with their schedules paused", async () => {
			const { onA, link } = await waiting();
			const result = await membershipOf(link).leave();
			const own = paired.device.space(
				result.split?.spaceId as string,
				NIGHT_SHIFT,
			);
			expect((await own.flows.list(onA.id)).map((f) => f.name)).toEqual([
				expect.stringMatching(/^hello-[0-9a-f]{8}$/),
			]);
			const { schedules } = await own.listSchedules(onA.id);
			expect(schedules.map((s) => [s.id, s.enabled])).toEqual([
				[`nightly-${result.split?.spaceId.slice(0, 8)}`, false],
			]);
		});

		test("come along after a stop before the batch, and one behind it, once", async () => {
			const { onA, source, link } = await waiting();
			await revoke();
			await expect(
				splitter({
					engine: beforeBatch(() => {
						throw new Error("stop");
					}),
				}).revoked(home),
			).rejects.toThrow("stop");
			expect(await b.db.select().from(spaceMerge)).toHaveLength(1);
			const broken = membershipOf(link, {
				spaces: { open: () => Promise.reject(new Error("stop")) },
			});
			await expect(broken.revoked(home)).rejects.toThrow("stop");
			const split = await membershipOf(link).revoked(home);
			const own = paired.device.space(split?.spaceId as string, NIGHT_SHIFT);
			expect((await own.flows.list(onA.id)).map((f) => f.name)).toEqual([
				expect.stringMatching(/^hello-[0-9a-f]{8}$/),
			]);
			expect((await own.listSchedules(onA.id)).schedules).toHaveLength(1);
			// Nothing of the source goes.
			expect(await flowsIn(source)).toEqual(["hello"]);
		});

		test("stay with their project of a shared Space", async () => {
			const { onA, link } = await waiting(true);
			await membershipOf(link).leave();
			expect(await flowsIn(onA.id)).toEqual([
				expect.stringMatching(/^hello-[0-9a-f]{8}$/),
			]);
		});

		test("that do not merge keep the split going: the Project each goes to is not forgotten", async () => {
			const { onA, link } = await waiting();
			await revoke();
			const engine = {
				...paired.device,
				flows: {
					...paired.device.flows,
					merge: () => Promise.reject(new Error("unreadable")),
				},
			} as MembershipTestDeps["engine"];
			await expect(
				membershipOf(link, { engine }).revoked(home),
			).rejects.toThrow("unreadable");
			const [row] = await b.db.select().from(spaceSplit);
			expect(row?.state).toBe("moved");
			const split = await membershipOf(link).revoked(home);
			const own = paired.device.space(split?.spaceId as string, NIGHT_SHIFT);
			expect((await own.flows.list(onA.id)).map((f) => f.name)).toEqual([
				expect.stringMatching(/^hello-[0-9a-f]{8}$/),
			]);
		});
	});

	for (const state of ["done", "planned"] as const) {
		for (const wins of [1, 4_000_000_000]) {
			test(`flows that wait never take the place of those the Host has (${state} split, writer ${wins})`, async () => {
				const { onA, source, link } = await waitingForHost();
				const flowsOnA = createProjectFlows({
					documents: createFlowDocuments({ db: a.db }),
					project: async () => ({ spaceId: "" }),
					deviceId: "a",
				});
				const theirFlow = {
					...quickFlow,
					nodes: [{ ...quickFlow.nodes[0], command: "echo host" }],
				} as Flow;
				await flowsOnA.save(onA.id, "hello", theirFlow);
				await flowsOnA.saveSchedules(onA.id, [
					{
						id: "nightly",
						flow: "hello",
						inputs: {},
						cron: "0 5 * * *",
						enabled: false,
					},
				]);
				(await paired.flows.open(onA.id)).current.doc.clientID = wins;
				await revoke();
				const membership = membershipOf(link, {
					engine:
						state === "done"
							? paired.device
							: beforeBatch(() => {
									throw new Error("stop");
								}),
				});
				await membership.revoked(home).catch(() => {});
				await joinAgain();
				await membershipOf(undefined).beforeJoin();
				const schedules = await syncedSchedules(onA.id);
				const onHost = schedules.find((s) => s.id === "nightly");
				expect(onHost).toMatchObject({ cron: "0 5 * * *", enabled: false });
				expect(schedules.filter((s) => s.enabled)).toEqual([]);
				const flows = await createProjectFlows({
					documents: createFlowDocuments({ db: a.db }),
					project: async () => ({ spaceId: "" }),
					deviceId: "a",
				}).flows(onA.id);
				expect(JSON.stringify(flows.hello)).toContain("echo host");
				expect(Object.keys(flows)).toHaveLength(state === "done" ? 2 : 1);
				expect(await flowNames(source)).toEqual(["hello"]);
			});
		}
	}

	for (const wins of [1, 4_000_000_000]) {
		test(`a schedule of flows that waited starts the flow it was made for, also after a join again (writer ${wins})`, async () => {
			const { onA, link, source } = await waitingForHost();
			// Before the leave: a flow that calls another one.
			const here = createProjectFlows({
				documents: paired.flows,
				project: async () => ({ spaceId: "" }),
				deviceId: b.deviceId,
			});
			await here.save(source, "caller", {
				...quickFlow,
				start: "call",
				nodes: [
					{
						id: "call",
						type: "call",
						position: { x: 0, y: 0 },
						flow: "hello",
						inputs: {},
					},
				],
			} as Flow);
			await here.saveSchedules(source, [
				...(await here.schedules(source)).schedules,
				{
					id: "second",
					flow: "caller",
					inputs: {},
					cron: "0 1 * * *",
					enabled: true,
				},
			]);
			const flowsOnA = () =>
				createProjectFlows({
					documents: createFlowDocuments({ db: a.db }),
					project: async () => ({ spaceId: "" }),
					deviceId: "a",
				});
			await flowsOnA().save(onA.id, "hello", {
				...quickFlow,
				nodes: [{ ...quickFlow.nodes[0], command: "echo host" }],
			} as Flow);
			(await paired.flows.open(onA.id)).current.doc.clientID = wins;

			await revoke();
			const split = await membershipOf(link).revoked(home);
			const own = paired.device.space(split?.spaceId as string, NIGHT_SHIFT);
			const { schedules } = await own.listSchedules(onA.id);
			const ours = (await own.flows.list(onA.id)).map((f) => f.name);
			const hello = schedules.find((s) => s.id.startsWith("nightly"))?.flow;
			expect(ours).toContain(hello as string);
			// On, off and new while apart.
			await own.saveSchedules(onA.id, [
				...schedules.map((s) => ({
					...s,
					enabled: s.id.startsWith("nightly"),
				})),
				{
					id: "new-here",
					flow: hello as string,
					inputs: {},
					cron: "0 4 * * *",
					enabled: true,
				},
			]);
			await joinAgain();
			await membershipOf(undefined).beforeJoin();
			const { link: again } = linkToA();
			await ready(again);
			await membershipOf(again).merge();
			const synced = await syncedSchedules(onA.id);
			const flows = await flowsOnA().flows(onA.id);
			const started = (name: string | undefined) =>
				JSON.stringify(flows[name as string]);
			expect(synced.map((s) => [s.id.split("-")[0], s.enabled]).sort()).toEqual(
				[
					["new", true],
					["nightly", true],
					["second", false],
				],
			);
			for (const s of synced) {
				expect(started(s.flow)).not.toContain("echo host");
				if (s.id.startsWith("second")) {
					expect(started(s.flow)).toContain(`"flow":"${hello}"`);
				} else expect(started(s.flow)).toContain("echo hello");
			}
			expect(started("hello")).toContain("echo host");
		});
	}

	test("a project without a folder comes along: every Device has it", async () => {
		const { projectId } = await mergedIntoA();
		const leads = await paired.host
			.space(a.spaceId, NIGHT_SHIFT)
			.addProjectWithoutFolder({ name: "Leads" });
		await paired.projectOnDevice(leads.id);
		await revoke();

		const result = await splitter().revoked(home);

		expect(result).toMatchObject({ state: "done", projects: 2 });
		const own = result?.spaceId as string;
		const projects = await paired.device.space(own, NIGHT_SHIFT).listProjects();
		expect(
			projects.map((p) => [p.id, p.folder, p.repoPath !== null]).sort(),
		).toEqual(
			[
				[projectId, true, true],
				[leads.id, false, false],
			].sort(),
		);
	});

	test("a schedule that is on is paused on B after the split, without its Person; turned on, it has a next start", async () => {
		const { projectId } = await mergedIntoA();
		// What A saved: a schedule for the Person.
		const flows = createProjectFlows({
			documents: paired.flows,
			project: async () => ({ spaceId: "" }),
			deviceId: "A",
		});
		const saved = await flows.schedules(projectId, { validate: false });
		await flows.saveSchedules(projectId, [
			...saved.schedules,
			{
				id: "on-c",
				flow: "hello",
				inputs: {},
				cron: "0 6 * * *",
				enabled: true,
				person: paired.personId,
			},
		]);
		await revoke();

		const result = await splitter().revoked(home);

		expect(result).toMatchObject({ state: "done", unpinned: 2 });
		const own = result?.spaceId as string;
		const { schedules } = await paired.device
			.space(own, NIGHT_SHIFT)
			.listSchedules(projectId);
		const byId = new Map(schedules.map((s) => [s.id, s]));
		expect(byId.get("nightly")).toMatchObject({ enabled: false });
		// A still fires it: B does not run it a second time.
		expect(byId.get("on-c")).toMatchObject({
			enabled: false,
			nextAt: null,
			cron: "0 6 * * *",
		});
		expect(byId.get("on-c")?.person).toBeUndefined();
		expect((await b.db.select().from(spaceSplit))[0]?.unpinned).toBe(2);

		await paired.device.space(own, NIGHT_SHIFT).saveSchedules(
			projectId,
			schedules.map((schedule) =>
				schedule.id === "on-c" ? { ...schedule, enabled: true } : schedule,
			),
		);
		const turnedOn = await paired.device
			.space(own, NIGHT_SHIFT)
			.listSchedules(projectId);
		expect(
			turnedOn.schedules.find((s) => s.id === "on-c")?.nextAt,
		).not.toBeNull();
	});

	test("the commands of the runs B walked move with them, in the name of B's own Person; those of A's runs stay", async () => {
		const { projectId, runId } = await mergedIntoA();
		await walkedByA(projectId);
		const command = (id: string, ofRun: string, walkerId: string) => ({
			id,
			spaceId: a.spaceId,
			runId: ofRun,
			walkerId,
			kind: "run.stop" as const,
			payload: "{}",
			personId: paired.personId,
		});
		await b.db
			.insert(runCommand)
			.values([
				command("command-of-b", runId, b.deviceId),
				command("command-of-a", "run-walked-by-a", a.deviceId),
			]);
		await revoke();

		const result = await splitter().revoked(home);

		const commands = await b.db
			.select({
				id: runCommand.id,
				spaceId: runCommand.spaceId,
				personId: runCommand.personId,
			})
			.from(runCommand)
			.orderBy(runCommand.id);
		expect(commands).toEqual([
			{ id: "command-of-a", spaceId: a.spaceId, personId: paired.personId },
			{
				id: "command-of-b",
				spaceId: result?.spaceId as string,
				personId: localPerson,
			},
		]);
	});

	test("a split that is done does not run again", async () => {
		await mergedIntoA();
		await revoke();
		const first = await splitter().revoked(home);

		expect(await splitter().revoked(home)).toBeNull();
		expect(await b.db.select().from(spaceSplit)).toHaveLength(1);
		expect(await personalSpaceId(b.db, localPerson)).toBe(
			first?.spaceId ?? "none",
		);
	});

	test("two asks at once split once, and both see the same Space", async () => {
		await mergedIntoA();
		await revoke();
		const split = splitter();

		const [first, second] = await Promise.all([
			split.revoked(home),
			split.revoked(home),
		]);

		expect(first?.state).toBe("done");
		expect(second).toBeNull();
		const [row] = await b.db.select().from(spaceSplit);
		expect(row?.toSpace).toBe(first?.spaceId as string);
		expect(await b.db.select().from(spaceSplit)).toHaveLength(1);
	});

	test("nothing splits while B still has access to A", async () => {
		await mergedIntoA();

		expect(await splitter().revoked(home)).toBeNull();
		expect(await personalSpaceId(b.db, localPerson)).toBe(a.spaceId);
		expect(await b.db.select().from(spaceSplit)).toEqual([]);
	});

	test("a Personal of B's own, never merged, stays as it is", async () => {
		await revoke();

		expect(await splitter().revoked(home)).toBeNull();
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
				engine: beforeBatch(() => {
					throw new Error("Stopped before the batch.");
				}),
			}).revoked(home),
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
			}).revoked(home),
		).rejects.toThrow("Stopped after the batch.");
		expect(await state()).toBe("moved");
		const [row] = await b.db.select().from(spaceSplit);
		expect(await runOf(b, runId)).toMatchObject({ spaceId: row?.toSpace });

		fail = false;
		const done = await splitter().revoked(home);
		expect(done).toMatchObject({
			state: "done",
			spaceId: row?.toSpace,
			projects: 1,
			runs: 1,
		});
		expect(await state()).toBe("done");
		const projects = await paired.device
			.space(row?.toSpace as string, NIGHT_SHIFT)
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
		const space = paired.device.space(a.spaceId, NIGHT_SHIFT);
		const waiting = await space.startRun({ projectId, flow: gateFlow });
		await waitFor(
			async () => (await space.getRun(waiting.id)).status === "waiting",
			{ label: "B's run waits", timeoutMs: 10_000 },
		);
		await revoke();

		const refused = splitter().revoked(home);
		await expect(refused).rejects.toBeInstanceOf(Refusal);
		await expect(refused).rejects.toThrow(SPLIT_WORDS.notDone(1));
		expect(await b.db.select().from(spaceSplit)).toEqual([]);

		await space.act(waiting.id, { kind: "stop" });
		await waitFor(
			async () => (await space.getRun(waiting.id)).status !== "waiting",
			{ label: "B's run stopped", timeoutMs: 10_000 },
		);
		const result = await splitter().revoked(home);
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

		expect(await splitter().revoked(home)).toBeNull();
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
						hostLinks.revoked(paired.hostId).then(() => split.revoked(home)),
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
		const result = await membershipOf(link, {
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
		}).leave();
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

	for (const [who, told, named] of [
		["the Host it leaves", true, () => ({ hostId: paired.hostId })],
		["another Host", false, () => ({ hostId: "host-c" })],
		["no Host", false, () => undefined],
	] as const) {
		test(`a leave that a refusal of ${who} answers is ${told ? "told" : "not told"}, and B leaves`, async () => {
			await mergedIntoA();
			const { link } = linkToA({ push: false });
			await ready(link);
			const refusing: Link = {
				...link,
				call: () =>
					Promise.reject(
						fromHost(new ORPCError("UNAUTHORIZED", { data: named() })),
					),
			};
			const { result, deleted } = await leave(refusing);
			expect(result).toMatchObject({ told, split: { state: "done" } });
			expect(deleted).toEqual([paired.hostId]);
		});
	}

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
		const space = paired.device.space(a.spaceId, NIGHT_SHIFT);
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
