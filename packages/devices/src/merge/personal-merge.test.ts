import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { personalSpaceId } from "@nightshift/auth";
import {
	device,
	event,
	hostSpace,
	organization,
	project,
	run as runTable,
	spaceMerge,
	user,
} from "@nightshift/db/schema";
import { createFlowDocuments } from "@nightshift/engine";
import {
	createSandbox,
	mustGit,
	type Sandbox,
	seedFlows,
	waitFor,
} from "@nightshift/engine/testing";
import type { Flow } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { ORPCError } from "@orpc/client";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import type { HostClient } from "../contract";
import { createDeviceExchange } from "../exchange";
import { createHostLinks, type Link } from "../links";
import { httpsLink } from "../links/link";
import { type PairedReplicas, pairedReplicas } from "../testing";
import {
	createPersonalMerge,
	MERGE_WORDS,
	type PersonalMergeDeps,
} from "./personal-merge";

/**
 * The merge of a Device's own Personal into its Person's Personal on its
 * home Host, end to end in one process: B (the Device) merges into A
 * (the Host), over a real link to A in memory, with B's real exchange
 * pushing the moved runs. A and B have their own Persons and Spaces, as
 * the author's laptop and Host do.
 */

let a: Sandbox;
let b: Sandbox;
let paired: PairedReplicas;
/** B's own Person. A knows them as `paired.personId`. */
let localPerson: string;
/** The links still open: closed after each test. */
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

/** One command step: a run that ends on its own. */
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

/** B's link to A in memory, with B's exchange: it pushes what B walks. */
function online(options: { push?: boolean; synced?: () => boolean } = {}) {
	const client: HostClient = paired.memory.client(paired.key);
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
	const synced = options.synced ?? (() => true);
	const merged: Link = { ...link, synced: () => synced() };
	const period = {
		link: merged,
		async stop() {
			detach();
			await link.close();
		},
	};
	periods.push(period);
	return period;
}

function merger(
	link: Link,
	extra: Partial<PersonalMergeDeps> = {},
): ReturnType<typeof createPersonalMerge> {
	return createPersonalMerge({
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
		...extra,
	});
}

/** Waits until the link answers. */
async function ready(link: Link) {
	await waitFor(async () => link.state().status === "online", {
		label: "B's link online",
		timeoutMs: 5_000,
	});
}

/** A git repository in B's sandbox with `origin` at `remote`. */
async function repoWithRemote(sandbox: Sandbox, name: string, remote: string) {
	const path = join(sandbox.root, name);
	await mkdir(path, { recursive: true });
	await mustGit(path, ["init", "-q", "-b", "main"]);
	await Bun.write(join(path, "README.md"), `# ${name}\n`);
	await mustGit(path, ["add", "README.md"]);
	await mustGit(path, [
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@nightshift.invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-q",
		"-m",
		"initial",
	]);
	await mustGit(path, ["remote", "add", "origin", remote]);
	return path;
}

/** A project in B's own Personal with one run that finished. */
async function projectWithRun(repoPath: string = b.repoPath) {
	const space = paired.device.space(b.spaceId);
	const added = await space.addProject({ repoPath });
	await seedFlows(space, added.id, { hello: quickFlow });
	const run = await space.startRun({ projectId: added.id, flow: quickFlow });
	await waitFor(
		async () => (await space.getRun(run.id)).status === "finished",
		{ label: "B's run finished", timeoutMs: 10_000 },
	);
	return { projectId: added.id, runId: run.id };
}

/** Brings A's flow documents of a project to B, as the link's document sync does. */
async function syncFlows(projectId: string) {
	const onA = createFlowDocuments({ db: a.db });
	const theirs = await onA.open(projectId);
	const ours = await paired.flows.open(projectId);
	Y.applyUpdate(ours.current.doc, Y.encodeStateAsUpdate(theirs.current.doc));
	Y.applyUpdate(ours.history.doc, Y.encodeStateAsUpdate(theirs.history.doc));
	await onA.close();
}

async function spaceOfRun(sandbox: Sandbox, runId: string) {
	const [row] = await sandbox.db
		.select({ spaceId: runTable.spaceId, startedBy: runTable.startedBy })
		.from(runTable)
		.where(eq(runTable.id, runId));
	return row ?? null;
}

describe("the merge of Personal", () => {
	test("end to end: Personal becomes the Host's, named Personal, and its runs reach the Host", async () => {
		const { projectId, runId } = await projectWithRun();
		const { link } = online();
		await ready(link);

		const result = await merger(link).run();

		expect(result).toMatchObject({ state: "pushed", projects: 1, runs: 1 });
		expect(existsSync(result.backup)).toBe(true);
		// One personal Space on B: the Host's, named Personal.
		expect(await personalSpaceId(b.db, localPerson)).toBe(a.spaceId);
		const spaces = await b.db.select().from(organization);
		expect(spaces.map((s) => s.id)).not.toContain(b.spaceId);
		expect(spaces.find((s) => s.id === a.spaceId)?.name).toBe("Personal");
		// The run is in it, started by B's Person as A knows them.
		expect(await spaceOfRun(b, runId)).toEqual({
			spaceId: a.spaceId,
			startedBy: paired.personId,
		});
		// A has the project, and the run, as B walked it.
		expect(await spaceOfRun(a, runId)).toEqual({
			spaceId: a.spaceId,
			startedBy: paired.personId,
		});
		const [onA] = await paired.host.space(a.spaceId).listProjects();
		expect(onA?.id).toBe(projectId);
		expect((await paired.host.space(a.spaceId).getRun(runId)).status).toBe(
			"finished",
		);
		const [row] = await b.db.select().from(spaceMerge);
		expect(row?.state).toBe("pushed");
	});

	test("the author's shape: two Persons, two Spaces, the Host's Personal empty", async () => {
		const dimpact = await repoWithRemote(
			b,
			"dimpact-zaakafhandelcomponent",
			"https://github.com/infonl/dimpact-zaakafhandelcomponent.git",
		);
		const rpg = await repoWithRemote(
			b,
			"rpgdotexe",
			"https://github.com/xiduzo/rpgdotexe.git",
		);
		const first = await projectWithRun(dimpact);
		const second = await projectWithRun(rpg);
		expect(localPerson).not.toBe(paired.personId);
		expect(b.spaceId).not.toBe(a.spaceId);
		const listed = await paired.device.hostSpaces.listed(paired.hostId);
		expect(listed).toEqual([
			{ id: a.spaceId, name: "Personal on A", personal: true },
		]);
		const { link } = online();
		await ready(link);

		const preview = await merger(link).preview();
		expect(preview.projects.map((p) => [p.name, p.into, p.runs])).toEqual([
			["dimpact-zaakafhandelcomponent", "new", 1],
			["rpgdotexe", "new", 1],
		]);
		const result = await merger(link).run();

		expect(result.state).toBe("pushed");
		const onA = await paired.host.space(a.spaceId).listProjects();
		expect(onA.map((p) => [p.id, p.remote]).sort()).toEqual(
			[
				[first.projectId, "github.com/infonl/dimpact-zaakafhandelcomponent"],
				[second.projectId, "github.com/xiduzo/rpgdotexe"],
			].sort(),
		);
		for (const { runId } of [first, second]) {
			expect(await spaceOfRun(a, runId)).toEqual({
				spaceId: a.spaceId,
				startedBy: paired.personId,
			});
		}
		// The next answer of the Host keeps the name: "Personal on A" is gone.
		const hello = await paired.memory.client(paired.key).link.hello();
		await paired.device.hostSpaces.update(
			{ id: paired.hostId, name: "A" },
			hello.spaces,
			localPerson,
		);
		expect(await paired.device.hostSpaces.listed(paired.hostId)).toEqual([
			{ id: a.spaceId, name: "Personal", personal: true },
		]);
		const [kept] = await b.db
			.select()
			.from(organization)
			.where(eq(organization.id, a.spaceId));
		expect(kept?.name).toBe("Personal");
	});

	test("a remote on both sides becomes one project with both histories", async () => {
		const remote = "https://github.com/acme/app.git";
		const onA = await paired.host.space(a.spaceId).addProject({
			repoPath: await repoWithRemote(a, "app", remote),
		});
		await seedFlows(paired.host.space(a.spaceId), onA.id, {
			hello: {
				...quickFlow,
				nodes: [{ ...quickFlow.nodes[0], command: "echo host" }],
			},
		});
		const hostRun = await paired.host
			.space(a.spaceId)
			.startRun({ projectId: onA.id, flow: quickFlow });
		await waitFor(
			async () =>
				(await paired.host.space(a.spaceId).getRun(hostRun.id)).status ===
				"finished",
			{ label: "A's run finished", timeoutMs: 10_000 },
		);
		const mine = await projectWithRun(await repoWithRemote(b, "app", remote));
		await syncFlows(onA.id);
		const { link } = online();
		await ready(link);

		const preview = await merger(link).preview();
		expect(preview.projects[0]).toMatchObject({
			into: "same-remote",
			renamedFlows: [{ from: "hello", to: "hello-2" }],
		});
		const result = await merger(link).run();

		expect(result.state).toBe("pushed");
		// One project on B, with A's id: B's runs are under it.
		const projects = await b.db
			.select({ id: project.id, remote: project.remote })
			.from(project)
			.where(eq(project.remote, "github.com/acme/app"));
		expect(projects).toEqual([{ id: onA.id, remote: "github.com/acme/app" }]);
		const runs = await paired.host
			.space(a.spaceId)
			.listRuns({ projectId: onA.id });
		expect(runs.map((r) => r.id).sort()).toEqual(
			[hostRun.id, mine.runId].sort(),
		);
		// Both flows, both histories.
		const flows = await paired.device.space(a.spaceId).listFlows(onA.id);
		expect(flows.map((f) => f.name).sort()).toEqual(["hello", "hello-2"]);
	});

	test("the preview changes nothing, here or on the Host", async () => {
		const { runId } = await projectWithRun();
		const { link } = online();
		await ready(link);
		const before = {
			spaces: await b.db.select().from(organization),
			projects: await b.db.select().from(project),
			events: await b.db.select({ n: event.seq }).from(event),
		};

		const preview = await merger(link).preview();

		expect(preview.runs).toBe(1);
		expect(await b.db.select().from(organization)).toEqual(before.spaces);
		expect(await b.db.select().from(project)).toEqual(before.projects);
		expect(await b.db.select({ n: event.seq }).from(event)).toEqual(
			before.events,
		);
		expect(await spaceOfRun(b, runId)).toMatchObject({ spaceId: b.spaceId });
		expect(await b.db.select().from(spaceMerge)).toEqual([]);
		expect(existsSync(join(b.dataDir, "backups"))).toBe(false);
		expect(await paired.host.space(a.spaceId).listProjects()).toEqual([]);
	});

	test("the copy of the database is there before the batch moves a row", async () => {
		const { runId } = await projectWithRun();
		const { link } = online();
		await ready(link);
		/** The copies of the database when the batch is put together. */
		const seen: string[][] = [];

		await merger(link, {
			moveStatements: () => {
				seen.push(readdirSync(join(b.dataDir, "backups")));
				return [];
			},
		}).run();
		const backups = await readdir(join(b.dataDir, "backups"));

		expect(seen).toEqual([backups]);
		expect(backups).toHaveLength(1);
		expect(backups[0]).toStartWith("before-personal-merge-");
		// The copy holds the run where it was before.
		const { createDb } = await import("@nightshift/db");
		const copy = createDb({
			DATABASE_URL: `file:${join(b.dataDir, "backups", backups[0] as string)}`,
		});
		const [old] = await copy
			.select({ spaceId: runTable.spaceId })
			.from(runTable)
			.where(eq(runTable.id, runId));
		copy.$client.close();
		expect(old?.spaceId).toBe(b.spaceId);
	});

	test("a merge stopped after each state goes on to the same end", async () => {
		const { runId } = await projectWithRun();
		// planned: the Host does not answer the first ask.
		const { link } = online({ push: false });
		await ready(link);
		let refuse = true;
		const flaky: Link = {
			...link,
			call: (use) => {
				if (refuse) {
					refuse = false;
					return Promise.reject(new TypeError("fetch failed"));
				}
				return link.call(use);
			},
		};
		await expect(merger(flaky).run()).rejects.toThrow();
		const state = async () =>
			(await b.db.select().from(spaceMerge))[0]?.state ?? null;
		expect(await state()).toBe("planned");

		// mapped: the batch is never made.
		await expect(
			merger(flaky, {
				moveStatements: () => {
					throw new Error("Stopped before the batch.");
				},
			}).run(),
		).rejects.toThrow("Stopped before the batch.");
		expect(await state()).toBe("mapped");
		expect(await spaceOfRun(b, runId)).toMatchObject({ spaceId: b.spaceId });

		// moved: the runs do not reach the Host yet (no push).
		const moved = await merger(flaky, { pushWaitMs: 100 }).run();
		expect(moved.state).toBe("moved");
		expect(await state()).toBe("moved");
		expect(await spaceOfRun(b, runId)).toMatchObject({ spaceId: a.spaceId });
		expect(await spaceOfRun(a, runId)).toBeNull();

		// The exchange is back: the merge ends.
		const pushing = online();
		await ready(pushing.link);
		const done = await merger(pushing.link).run();
		expect(done.state).toBe("pushed");
		expect(await spaceOfRun(a, runId)).toMatchObject({ spaceId: a.spaceId });
		// One copy of the database: the merge made it once.
		expect(await readdir(join(b.dataDir, "backups"))).toHaveLength(1);
	});

	test("the flows wait for the Host's copy of the project they join", async () => {
		const remote = "https://github.com/acme/app.git";
		const onA = await paired.host.space(a.spaceId).addProject({
			repoPath: await repoWithRemote(a, "app", remote),
		});
		await projectWithRun(await repoWithRemote(b, "app", remote));
		let synced = false;
		const { link } = online({ synced: () => synced });
		await ready(link);

		await expect(merger(link).run()).rejects.toBeInstanceOf(Refusal);
		expect((await b.db.select().from(spaceMerge))[0]?.state).toBe("moved");
		synced = true;
		const done = await merger(link).run();

		expect(done.state).toBe("pushed");
		const flows = await paired.device.space(a.spaceId).listFlows(onA.id);
		expect(flows.map((f) => f.name)).toEqual(["hello"]);
	});

	test("a merge that is done does not run again", async () => {
		await projectWithRun();
		const { link } = online();
		await ready(link);
		await merger(link).run();

		await expect(merger(link).run()).rejects.toThrow(MERGE_WORDS.merged);
		await expect(merger(link).preview()).rejects.toThrow(MERGE_WORDS.merged);
		expect(await b.db.select().from(spaceMerge)).toHaveLength(1);
	});

	test("a computer that is a Host with paired devices keeps its Personal", async () => {
		await b.db.insert(device).values({
			id: "phone-ish",
			name: "C",
			platform: "test",
			ownerId: localPerson,
			homeHost: "https://b.invalid",
		});
		const { link } = online();
		await ready(link);

		await expect(merger(link).preview()).rejects.toThrow(MERGE_WORDS.isHost);
		await expect(merger(link).run()).rejects.toThrow(MERGE_WORDS.isHost);
		expect(await personalSpaceId(b.db, localPerson)).toBe(b.spaceId);
	});

	test("a run of Personal that is not done holds the merge back", async () => {
		const space = paired.device.space(b.spaceId);
		const added = await space.addProject({ repoPath: b.repoPath });
		const gate = {
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
		const waiting = await space.startRun({ projectId: added.id, flow: gate });
		await waitFor(
			async () => (await space.getRun(waiting.id)).status === "waiting",
			{ label: "B's run waits", timeoutMs: 10_000 },
		);
		const { link } = online();
		await ready(link);

		await expect(merger(link).run()).rejects.toThrow(
			"A run in Personal is not done yet.",
		);
		expect(await b.db.select().from(spaceMerge)).toEqual([]);
	});

	test("an older Host without the merge refuses it politely", async () => {
		const { link } = online({ push: false });
		await ready(link);
		const older: Link = {
			...link,
			call: () =>
				Promise.reject(new ORPCError("NOT_FOUND", { message: "Not found" })),
		};

		await expect(merger(older).preview()).rejects.toThrow(
			MERGE_WORDS.olderHost,
		);
		expect(await b.db.select().from(spaceMerge)).toEqual([]);
	});

	test("an offline Host refuses before anything changes", async () => {
		await projectWithRun();
		const offline: Link = {
			...online({ push: false }).link,
			state: () => ({ status: "offline", address: null, since: 0 }),
		};

		await expect(merger(offline).run()).rejects.toThrow(MERGE_WORDS.offline);
		expect(await b.db.select().from(spaceMerge)).toEqual([]);
		expect(existsSync(join(b.dataDir, "backups"))).toBe(false);
	});

	test("the Host's personal Space keeps the name the Host gives it before a merge", async () => {
		const rows = await b.db.select().from(hostSpace);
		expect(rows.map((r) => r.name)).toEqual(["Personal on A"]);
	});
});
