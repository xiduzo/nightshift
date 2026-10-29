import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import {
	clone,
	device as deviceTable,
	event,
	hostLink,
	member,
	organization,
	run as runTable,
	user,
} from "@nightshift/db/schema";
import {
	createProfileStore,
	createSpaceDocuments,
	deviceDocumentName,
	documentRows,
	HostUnreachableError,
	type ListedProject,
	type OwnDevice,
	openDeviceDocument,
	placedRun,
	type RunStatus,
	recordClone,
	type SpaceDocuments,
} from "@nightshift/engine";
import {
	createSandbox,
	mustGit,
	type Sandbox,
	seedFlows,
	sleepClock,
	testDevice,
	waitFor,
} from "@nightshift/engine/testing";
import type { Flow, ProfileRef } from "@nightshift/flows";
import { and, eq } from "drizzle-orm";
import * as Y from "yjs";
import {
	type HostRelay,
	type WorkRelay,
	type WorkRequest,
	workRequestSchema,
} from "../contract";
import { createHostSpaces } from "../links";
import { type DeviceOffer, NO_STARTER } from "../offers";
import { createPeerEngine, deviceDirectory, type PeerEngine } from "../peers";
import { withPeers } from "../testing";
import { serveWork } from "../work/remote";
import { createPlacement, deviceNamed } from "./placement";

/**
 * Run-level Placement in one process: A walks a run whose steps run on
 * Device B. A has no Clone of the project; B has. The work relay is
 * in-memory here (`serveWork` on B's local Device, after B reads the
 * request as its work server does), the Host's hub in the daemon.
 */

let a: Sandbox;
let b: Sandbox;
let engine: PeerEngine;
/** A's engine's lifetime. */
let lifetime: AbortController;
let work: WorkRelay;
let documents: SpaceDocuments;
let online: Set<string>;
let requests: WorkRequest[];
/** B's calls that are still running there. */
let running: number;
let personId: string;
let projectId: string;
const B = "device-b";

/** An Agent Profile on Claude Code. */
const PROFILE = {
	harness: "claude-code" as const,
	model: "sonnet",
	permissionMode: "auto" as const,
	clis: [],
	connections: [],
};

const bDevice = (projectOf: () => string) =>
	testDevice(
		{
			harnesses: { "claude-code": fakeHarness(reportingScript("pass")) },
			clonePath: async (id) => (id === projectOf() ? b.repoPath : null),
			findCli: (name) => (name === "git" ? "/usr/bin/git" : null),
			// B has the profile "everywhere"; only A has "here_only".
			profileFor: (name) => (name === "everywhere" ? PROFILE : null),
			// Only B has the secret B_TOKEN.
			secretEnv: async (names) => {
				const missing = names.filter((name) => name !== "B_TOKEN");
				return missing.length > 0
					? { ok: false, missing }
					: { ok: true, env: { B_TOKEN: "b-only-token" } };
			},
		},
		B,
	);

beforeEach(async () => {
	[a, b] = await Promise.all([createSandbox(), createSandbox()]);
	online = new Set([B]);
	requests = [];
	running = 0;
	const onB = bDevice(() => projectId);
	work = {
		online: (id) => online.has(id),
		async *call(id, request, signal) {
			if (!online.has(id)) {
				yield { kind: "error", message: "offline" };
				return;
			}
			requests.push(request);
			if (!workRequestSchema.safeParse(request).success) {
				yield {
					kind: "error",
					message:
						"This device cannot read that request. Update Night Shift on both computers.",
				};
				return;
			}
			const controller = new AbortController();
			signal?.addEventListener("abort", () => controller.abort(), {
				once: true,
			});
			running++;
			try {
				yield* serveWork(onB, request, controller.signal);
			} finally {
				running--;
			}
		},
	};
	documents = createSpaceDocuments({
		db: a.db,
		directory: deviceDirectory(a.db),
	});
	engine = peerEngine();
	const [self] = await a.db
		.select({ ownerId: deviceTable.ownerId })
		.from(deviceTable)
		.where(eq(deviceTable.self, true));
	personId = self?.ownerId as string;
	// A's project, then its folder on A goes: only B has a Clone.
	projectId = (
		await engine.space(a.spaceId).addProject({ repoPath: a.repoPath })
	).id;
	await a.db.delete(clone).where(and(eq(clone.projectId, projectId)));
	const document = await documents.open(a.spaceId);
	await document.change(() =>
		recordClone(document, { projectId, deviceId: B, deviceName: "studio-b" }),
	);
	await engine.devices.join({
		id: B,
		name: "studio-b",
		platform: "linux",
		ownerId: personId,
		homeHost: null,
	});
});

afterEach(async () => {
	lifetime.abort();
	await Promise.all([a.cleanup(), b.cleanup()]);
});

/** A's own profiles. */
const A_PROFILES = [
	{ id: "everywhere", name: "everywhere", kind: "agent" as const },
	{ id: "p-model", name: "judge", kind: "model" as const },
];

/** A's engine. Without `internals`, it fires no schedules. */
function peerEngine(
	internals?: Parameters<typeof createPeerEngine>[1],
	options: Pick<
		Parameters<typeof withPeers>[0],
		"ownOffers" | "mayUseOffers" | "deviceId"
	> = {},
): PeerEngine {
	lifetime = new AbortController();
	return createPeerEngine(
		withPeers({
			...options,
			db: a.db,
			dataDir: a.dataDir,
			...(internals ? {} : { scheduler: false as const }),
			harnesses: { "claude-code": fakeHarness(reportingScript("pass")) },
			profileFor: (name) =>
				name === "everywhere" || name === "here_only" ? PROFILE : null,
			ownProfiles: () => A_PROFILES,
			spaceDocuments: documents,
			work,
		}),
		{ ...internals, signal: lifetime.signal },
	);
}

const flow = (nodes: Flow["nodes"], edges: Flow["edges"] = []): Flow =>
	({
		version: 7,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "a",
		nodes,
		edges,
	}) as Flow;

const command = (id: string, line: string, extra: object = {}) =>
	({
		id,
		type: "command",
		position: { x: 0, y: 0 },
		command: line,
		output: "text",
		...extra,
	}) as Flow["nodes"][number];

const agent = (id: string, harness = "claude-code") =>
	({
		id,
		type: "agent",
		position: { x: 0, y: 0 },
		prompt: "Do the work.",
		harness,
		model: "sonnet",
		permissionMode: "auto",
	}) as Flow["nodes"][number];

async function until(runId: string, status: RunStatus) {
	return waitFor(
		async () => {
			const run = await engine.space(a.spaceId).getRun(runId);
			return run.status === status ? run : null;
		},
		{ label: `run ${status}`, timeoutMs: 10_000 },
	);
}

const space = () => engine.space(a.spaceId, { personId });

describe("a run placed on another Device", () => {
	test("its steps and its worktree are on that Device; this computer walks it", async () => {
		const started = await space().startRun({
			projectId,
			flow: flow(
				[command("where", "pwd"), agent("work")],
				[{ id: "e1", from: "where", outcome: "pass", to: "work" }],
			),
			startedBy: personId,
			deviceId: B,
		});
		expect(started.walker.thisDevice).toBe(true);
		expect(started.device).toEqual({
			id: B,
			name: "studio-b",
			thisDevice: false,
		});
		// The worktree is B's, beside B's Clone.
		expect(started.worktreePath.startsWith(b.root)).toBe(true);
		expect(existsSync(started.worktreePath)).toBe(true);

		const run = await until(started.id, "finished");
		expect(run.steps.map((s) => [s.nodeId, s.outcome, s.device?.id])).toEqual([
			["where", "pass", B],
			["work", "pass", B],
		]);
		expect(String(run.steps[0]?.outputs.log_tail).trim()).toBe(
			started.worktreePath,
		);
		expect(run.takeOverCommand).toBeNull();
		// Every call named the run and its starter: what B checks.
		expect(requests.length).toBeGreaterThan(0);
		for (const request of requests) {
			expect(request).toMatchObject({
				spaceId: a.spaceId,
				projectId,
				personId,
			});
		}
		// The flows come from this Replica's flow document: B is not asked for them.
		expect(requests.map((r) => r.call.kind)).not.toContain("flows");
		expect(requests.map((r) => r.call.kind)).toEqual(
			expect.arrayContaining(["capabilities", "worktree", "exec", "session"]),
		);
	});

	test("started here without a Device, on a computer without the project, it goes where the project's last run ran", async () => {
		// C, a third Device of the Person, has the project too.
		const C = "device-c";
		await engine.devices.join({
			id: C,
			name: "studio-c",
			platform: "linux",
			ownerId: personId,
			homeHost: null,
		});
		const document = await documents.open(a.spaceId);
		await document.change(() =>
			recordClone(document, { projectId, deviceId: C, deviceName: "studio-c" }),
		);
		online.add(C);
		const hello = flow([command("hello", "echo hello")]);
		// The last run goes to the Device that is not first in the list.
		const listed = (await space().listPlacements(projectId)).map(
			(p) => p.deviceId,
		);
		expect([...listed].sort()).toEqual([B, C]);
		const first = listed[0] as string;
		const last = listed[1] as string;
		await until(
			(await space().startRun({ projectId, flow: hello, deviceId: last })).id,
			"finished",
		);
		expect(
			(await space().listPlacements(projectId)).map((p) => [
				p.deviceId,
				p.lastRun ?? false,
			]),
		).toEqual([
			[first, false],
			[last, true],
		]);

		const started = await space().startRun({ projectId, flow: hello });
		expect(started.device).toMatchObject({ id: last, thisDevice: false });
		await until(started.id, "finished");
	});

	test("a command's secrets are read there: the call names them, and the value comes back as •••", async () => {
		const started = await space().startRun({
			projectId,
			flow: flow([
				command("login", 'echo "token $B_TOKEN"', { secrets: ["B_TOKEN"] }),
			]),
			startedBy: personId,
			deviceId: B,
		});
		const run = await until(started.id, "finished");
		expect(run.steps[0]?.outputs.log_tail).toBe("token •••");
		const exec = requests.find((r) => r.call.kind === "exec");
		expect(exec?.call).toMatchObject({ input: { secrets: ["B_TOKEN"] } });
		expect(JSON.stringify(requests)).not.toContain("b-only-token");
	});

	test("a stop here ends the command there", async () => {
		const started = await space().startRun({
			projectId,
			flow: flow([command("long", "sleep 30")]),
			startedBy: personId,
			deviceId: B,
		});
		await waitFor(() => running > 0, { label: "the command on B" });
		await space().stopRun(started.id);
		await until(started.id, "stopped");
		await waitFor(() => running === 0, { label: "B's command to end" });
	});

	test("the flows come from this Replica's flow document, and the project is renamed without a Clone here", async () => {
		await seedFlows(space(), projectId, {
			hello: flow([command("hi", "echo hi")]),
		});
		expect(await space().listPlacements(projectId)).toEqual([
			{ deviceId: B, name: "studio-b", thisDevice: false, default: true },
		]);
		expect((await space().flows.list(projectId)).map((f) => f.name)).toEqual([
			"hello",
		]);
		expect(
			(await space().flows.get(projectId, "hello")).flow?.nodes,
		).toHaveLength(1);
		const renamed = await space().renameProject(projectId, "Renamed");
		expect(renamed.name).toBe("Renamed");

		const started = await space().startRun({
			projectId,
			flowName: "hello",
			startedBy: personId,
			deviceId: B,
		});
		const ran = await until(started.id, "finished");
		expect(String(ran.steps[0]?.outputs.log_tail).trim()).toBe("hi");
	});

	test("the project is removed without a Clone here", async () => {
		await space().removeProject(projectId);
		expect(await space().listProjects()).toEqual([]);
	});

	test("refusals name the Device: what it lacks, not the starter's, no Clone", async () => {
		await expect(
			space().startRun({
				projectId,
				flow: flow([agent("work", "codex")]),
				startedBy: personId,
				deviceId: B,
			}),
		).rejects.toThrow(
			"The flow has an Agent node on Codex (work), but no Codex harness is added on studio-b.",
		);

		await a.db.insert(organization).values({
			id: "personal-someone-else",
			name: "Personal",
			slug: "personal-someone-else",
			createdAt: new Date(),
		});
		await engine.devices.join({
			id: "device-c",
			name: "colleague-laptop",
			platform: "darwin",
			ownerId: "someone-else",
			homeHost: null,
		});
		online.add("device-c");
		await expect(
			space().startRun({
				projectId,
				flow: flow([command("hi", "echo hi")]),
				startedBy: personId,
				deviceId: "device-c",
			}),
		).rejects.toThrow("colleague-laptop is not your device.");

		await engine.devices.join({
			id: "device-d",
			name: "spare",
			platform: "linux",
			ownerId: personId,
			homeHost: null,
		});
		online.add("device-d");
		await expect(
			space().startRun({
				projectId,
				flow: flow([command("hi", "echo hi")]),
				startedBy: personId,
				deviceId: "device-d",
			}),
		).rejects.toThrow("spare does not have this project.");
		expect(await engine.space(a.spaceId).listRuns()).toEqual([]);
	});
});

describe("a run whose Device is offline at the start", () => {
	/** The events of the run, by type, in the order they were logged. */
	async function typesOf(runId: string): Promise<string[]> {
		return (await a.db.select().from(event).where(eq(event.runId, runId)))
			.sort((x, y) => x.seq - y.seq)
			.map((e) => e.type);
	}

	test("starts without its worktree, waits for the Device, and makes the worktree there when it is back", async () => {
		online.delete(B);
		const started = await space().startRun({
			projectId,
			flow: flow([command("where", "pwd")]),
			startedBy: personId,
			deviceId: B,
		});
		expect(started.device).toEqual({
			id: B,
			name: "studio-b",
			thisDevice: false,
		});
		expect(started.branch).toBe("");
		expect(started.worktreePath).toBe("");
		const asleep = await until(started.id, "sleeping");
		expect(asleep.steps[0]?.nodeId).toBe("where");
		const waited = (await a.db.select().from(event)).find(
			(e) => e.type === "WaitStarted",
		);
		expect(JSON.parse(waited?.payload ?? "{}")).toMatchObject({
			reason: "device-offline",
			deviceId: B,
			message: "studio-b is offline. The step starts when it is back.",
		});
		expect(await typesOf(started.id)).not.toContain("WorktreeCreated");

		online.add(B);
		await engine.deviceBack(B);
		const run = await until(started.id, "finished");
		// The worktree is B's, beside B's Clone, and the step ran in it.
		expect(run.branch).toStartWith("nightshift/");
		expect(run.worktreePath.startsWith(b.root)).toBe(true);
		expect(existsSync(run.worktreePath)).toBe(true);
		expect(String(run.steps[0]?.outputs.log_tail).trim()).toBe(
			run.worktreePath,
		);
		// The row keeps no worktree: the event is the fact.
		const [row] = await a.db
			.select()
			.from(runTable)
			.where(eq(runTable.id, started.id));
		expect(row?.branch).toBe("");
		expect(await typesOf(started.id)).toContain("WorktreeCreated");
	}, 20_000);

	test("starts from the base the person asked for, when the Device is back", async () => {
		const base = (await mustGit(b.repoPath, ["rev-parse", "HEAD"])).trim();
		await mustGit(b.repoPath, [
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@nightshift.invalid",
			"commit",
			"-q",
			"--allow-empty",
			"-m",
			"later",
		]);
		online.delete(B);
		const started = await space().startRun({
			projectId,
			flow: flow([command("where", "git rev-parse HEAD")]),
			startedBy: personId,
			deviceId: B,
			baseRef: base,
		});
		expect(started.baseRef).toBe(base);
		await until(started.id, "sleeping");
		online.add(B);
		await engine.deviceBack(B);
		const run = await until(started.id, "finished");
		expect(run.baseRef).toBe(base);
		expect(String(run.steps[0]?.outputs.log_tail).trim()).toBe(base);
	}, 20_000);

	test("a step that needs no computer runs while the Device is offline", async () => {
		online.delete(B);
		const started = await space().startRun({
			projectId,
			flow: flow(
				[
					{
						id: "rule",
						type: "decision",
						position: { x: 0, y: 0 },
						prompt: "Go on?",
						options: [{ name: "pass" }],
						by: "rule",
						rule: '"pass"',
					},
					command("where", "pwd"),
				] as Flow["nodes"],
				[{ id: "e1", from: "rule", outcome: "pass", to: "where" }],
			),
			startedBy: personId,
			deviceId: B,
		});
		const asleep = await until(started.id, "sleeping");
		expect(asleep.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["rule", "pass"],
			["where", null],
		]);
	}, 20_000);

	test("the Device stays offline: the run waits up to the stop time, then the step stops", async () => {
		const clock = sleepClock();
		lifetime.abort();
		await engine.dispose();
		engine = peerEngine({ minuteMs: 50, now: clock.now });
		online.delete(B);
		const stopAt = clock.now() + 125;
		const started = await space().startRun({
			projectId,
			flow: flow([command("where", "pwd")]),
			startedBy: personId,
			deviceId: B,
			stopAt,
		});
		const run = await clock.follow(space(), started.id);
		expect(run.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["where", "stopped"],
		]);
		expect(run.branch).toBe("");
		expect(await typesOf(started.id)).not.toContain("WorktreeCreated");
	}, 20_000);
});

describe("nodes placed on Devices, with the Hand-off", () => {
	/** A git line with a test identity. */
	const git = (line: string) =>
		line.replace(
			/^git /,
			"git -c user.name=Test -c user.email=test@nightshift.invalid -c commit.gpgsign=false ",
		);

	/** A has its Clone back, and A and B share one remote. */
	async function shareRemote(): Promise<void> {
		await a.db.insert(clone).values({
			id: "clone-a",
			spaceId: a.spaceId,
			projectId,
			deviceId: a.deviceId,
			path: a.repoPath,
		});
		const remote = join(a.root, "remote.git");
		await mustGit(a.root, ["init", "-q", "--bare", remote]);
		await mustGit(a.repoPath, ["remote", "add", "origin", remote]);
		await mustGit(b.repoPath, ["remote", "add", "origin", remote]);
	}

	const commitOn = (id: string, file: string, device?: string) => ({
		...command(
			id,
			[
				`test ! -e ${file}`,
				`echo ${file} > ${file}`,
				"git add .",
				git(`git commit -q -m ${file}`),
				"ls",
			].join(" && "),
		),
		...(device ? { device } : {}),
	});

	test("a node on B gets the work by a Hand-off and gives it back", async () => {
		await shareRemote();
		const started = await space().startRun({
			projectId,
			flow: flow(
				[
					commitOn("one", "one.txt"),
					commitOn("two", "two.txt", "studio-b"),
					{ ...command("three", "ls"), device: undefined },
				] as Flow["nodes"],
				[
					{ id: "e1", from: "one", outcome: "pass", to: "two" },
					{ id: "e2", from: "two", outcome: "pass", to: "three" },
				],
			),
			startedBy: personId,
		});
		const run = await until(started.id, "finished");
		expect(run.device.thisDevice).toBe(true);
		expect(run.steps.map((s) => [s.nodeId, s.device?.id])).toEqual([
			["one", a.deviceId === run.device.id ? a.deviceId : run.device.id],
			["two", B],
			["three", run.device.id],
		]);
		// B saw A's commit, and A saw B's.
		expect(String(run.steps[1]?.outputs.log_tail)).toContain("one.txt");
		expect(String(run.steps[2]?.outputs.log_tail)).toContain("two.txt");
		const handed = (await a.db.select().from(event)).filter(
			(e) => e.type === "HandedOff",
		);
		expect(
			handed.map((e) => {
				const p = JSON.parse(e.payload) as {
					from: string;
					to: string;
					commit: string;
				};
				return [
					p.from === B ? "B" : "A",
					p.to === B ? "B" : "A",
					p.commit.length,
				];
			}),
		).toEqual([
			["A", "B", 40],
			["B", "A", 40],
		]);
	});

	test("a dirty worktree fails the step that needs the work elsewhere", async () => {
		await shareRemote();
		const started = await space().startRun({
			projectId,
			flow: flow(
				[
					command("scribble", "echo draft > draft.txt"),
					{
						...command("there", "ls"),
						device: "studio-b",
					},
				] as Flow["nodes"],
				[{ id: "e1", from: "scribble", outcome: "pass", to: "there" }],
			),
			startedBy: personId,
		});
		const run = await until(started.id, "failed");
		expect(run.steps[1]?.outcome).toBe("error");
		expect(run.steps[1]?.error).toContain("not committed (draft.txt)");
		expect(run.steps[1]?.error).toContain("cannot move to studio-b");
	});

	test("a node whose Device is offline sleeps, and continues when it is back", async () => {
		await shareRemote();
		const started = await space().startRun({
			projectId,
			flow: flow(
				[
					command("first", "sleep 0.3"),
					{ ...command("ask", "echo from B"), device: "studio-b" },
				] as Flow["nodes"],
				[{ id: "e1", from: "first", outcome: "pass", to: "ask" }],
			),
			startedBy: personId,
		});
		// It goes away after the start.
		online.delete(B);
		const asleep = await until(started.id, "sleeping");
		expect(asleep.steps[1]?.nodeId).toBe("ask");
		const waited = (await a.db.select().from(event)).find(
			(e) => e.type === "WaitStarted",
		);
		expect(JSON.parse(waited?.payload ?? "{}")).toMatchObject({
			reason: "device-offline",
			deviceId: B,
			deviceName: "studio-b",
			message: "studio-b is offline. The step starts when it is back.",
		});
		online.add(B);
		await engine.deviceBack(B);
		const run = await until(started.id, "finished");
		expect(String(run.steps[1]?.outputs.log_tail).trim()).toBe("from B");
	}, 20_000);

	test("a node whose Device is offline at the start: the run starts, the step waits, and continues when it is back", async () => {
		await shareRemote();
		online.delete(B);
		const started = await space().startRun({
			projectId,
			flow: flow(
				[
					command("first", "true"),
					{ ...command("ask", "echo from B"), device: "studio-b" },
				] as Flow["nodes"],
				[{ id: "e1", from: "first", outcome: "pass", to: "ask" }],
			),
			startedBy: personId,
		});
		const asleep = await until(started.id, "sleeping");
		expect(asleep.steps[1]?.nodeId).toBe("ask");
		online.add(B);
		await engine.deviceBack(B);
		const run = await until(started.id, "finished");
		expect(String(run.steps[1]?.outputs.log_tail).trim()).toBe("from B");
	}, 20_000);

	test("a node whose Device stays offline waits up to the stop time, then the step stops", async () => {
		await shareRemote();
		const clock = sleepClock();
		lifetime.abort();
		await engine.dispose();
		engine = peerEngine({ minuteMs: 50, now: clock.now });
		online.delete(B);
		// Two retries a minute apart, then the stop time half a minute later.
		const stopAt = clock.now() + 125;
		const started = await space().startRun({
			projectId,
			flow: flow([
				{ ...command("ask", "echo from B"), device: "studio-b" },
			] as Flow["nodes"]),
			startedBy: personId,
			stopAt,
		});
		const run = await clock.follow(space(), started.id);
		expect(run.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["ask", "stopped"],
		]);
		const wakes = (await a.db.select().from(event))
			.filter((e) => e.type === "WaitStarted")
			.map((e) => JSON.parse(e.payload).until);
		expect(wakes).toEqual([stopAt - 75, stopAt - 25, stopAt]);
	}, 20_000);

	test("a profile on a node's Device that is offline: the run starts from its last known settings, and the step waits there", async () => {
		await shareRemote();
		// A keeps B's document, as a home Host does: B's profiles as B last said.
		const documentOfB = await openDeviceDocument({ db: a.db, deviceId: B });
		await createProfileStore({ document: documentOfB }).save(
			{
				name: "everywhere",
				harness: "claude-code",
				model: "sonnet",
				permissionMode: "acceptEdits",
				clis: [],
				connections: [],
			},
			"everywhere",
		);
		await documentOfB.close();
		online.delete(B);
		const work = (profile: string) =>
			flow([
				{
					id: "work",
					type: "agent",
					position: { x: 0, y: 0 },
					prompt: "Do the work.",
					profile: { device: B, profile },
				},
			] as Flow["nodes"]);
		await expect(
			space().startRun({
				projectId,
				flow: work("p-unknown"),
				startedBy: personId,
			}),
		).rejects.toThrow(
			"studio-b is offline, and Night Shift does not know its profile (work). Start the run when studio-b is online, or pick another profile.",
		);
		const started = await space().startRun({
			projectId,
			flow: work("everywhere"),
			startedBy: personId,
		});
		const asleep = await until(started.id, "sleeping");
		expect(asleep.steps[0]?.nodeId).toBe("work");
		expect(asleep.flow.nodes[0]).toMatchObject({
			profile: { device: B, profile: "everywhere" },
			model: "sonnet",
		});
		online.add(B);
		await engine.deviceBack(B);
		const run = await until(started.id, "finished");
		expect(run.steps[0]?.device?.id).toBe(B);
	}, 20_000);

	test("a node may not name a device its starter does not have", async () => {
		await shareRemote();
		await expect(
			space().startRun({
				projectId,
				flow: flow([
					{ ...command("ask", "true"), device: "nowhere" },
				] as Flow["nodes"]),
				startedBy: personId,
			}),
		).rejects.toThrow(
			'The flow names the device "nowhere", but you have no device of that name, and none of that name offers profiles to this Space.',
		);
	});

	test("a node's profile names its Device: the step runs there, by the Device's id", async () => {
		await shareRemote();
		const profiled = (id: string, profile: ProfileRef) =>
			({
				id,
				type: "agent",
				position: { x: 0, y: 0 },
				prompt: "Work.",
				profile,
			}) as Flow["nodes"][number];
		const started = await space().startRun({
			projectId,
			flow: flow(
				[
					profiled("there", { device: B, profile: "everywhere" }),
					profiled("here", { device: a.deviceId, profile: "here_only" }),
				],
				[{ id: "e1", from: "there", outcome: "pass", to: "here" }],
			),
			startedBy: personId,
			deviceId: B,
		});
		const run = await until(started.id, "finished");
		expect(run.device.id).toBe(B);
		expect(run.steps.map((s) => [s.nodeId, s.device?.id])).toEqual([
			["there", B],
			["here", run.walker.id === a.deviceId ? "test-device" : run.walker.id],
		]);
		expect(
			run.flow.nodes.map((n) => ("device" in n ? n.device : null)),
		).toEqual([null, null]);
		const [row] = await a.db
			.select()
			.from(runTable)
			.where(eq(runTable.id, started.id));
		if (!row) throw new Error("No run row.");
		const { plan } = placedRun(row);
		expect(plan.named).toEqual({});
		expect(plan.devices[B]).toEqual({ id: B, name: "studio-b" });
	});
});

describe("a run's plan", () => {
	/** A has its Clone back, and A and B share one remote. */
	async function shareRemote(): Promise<void> {
		await a.db.insert(clone).values({
			id: "clone-a",
			spaceId: a.spaceId,
			projectId,
			deviceId: a.deviceId,
			path: a.repoPath,
		});
		const remote = join(a.root, "remote.git");
		await mustGit(a.root, ["init", "-q", "--bare", remote]);
		await mustGit(a.repoPath, ["remote", "add", "origin", remote]);
		await mustGit(b.repoPath, ["remote", "add", "origin", remote]);
	}

	const gate = {
		id: "gate",
		type: "decision",
		position: { x: 0, y: 0 },
		prompt: "Go on?",
		options: [{ name: "yes" }],
		by: "person",
		decider: "typesafe",
	} as Flow["nodes"][number];

	/** gate → a command on studio-b. */
	const gateThenB = flow(
		[
			gate,
			{ ...command("there", "echo from B"), device: "studio-b" },
		] as Flow["nodes"],
		[{ id: "e1", from: "gate", outcome: "yes", to: "there" }],
	);

	const rowOf = async (runId: string) => {
		const [row] = await a.db
			.select()
			.from(runTable)
			.where(eq(runTable.id, runId));
		if (!row) throw new Error("No run row.");
		return row;
	};

	const openGate = async (runId: string) => {
		const waiting = await until(runId, "waiting");
		const step = waiting.steps.find((s) => s.nodeId === "gate");
		if (!step) throw new Error("No Gate step.");
		return step.id;
	};

	test("is made once at start and kept on the run: each Device with its name, and the Person", async () => {
		await shareRemote();
		const started = await space().startRun({
			projectId,
			flow: gateThenB,
			startedBy: personId,
		});
		const row = await rowOf(started.id);
		expect(placedRun(row).plan).toEqual({
			device: { id: started.device.id, name: "test" },
			named: { "studio-b": { id: B, name: "studio-b" } },
			devices: {
				[started.device.id]: { id: started.device.id, name: "test" },
				[B]: { id: B, name: "studio-b" },
			},
			personId,
		});
		// A Replica of a version before the plan reads the same Devices.
		expect(JSON.parse(row.placements ?? "{}")).toEqual({ "studio-b": B });
		await space().stopRun(started.id);
	});

	test("the walk reads it: after a restart, with no list of Devices here, a step runs on the run's Device by its planned name", async () => {
		const started = await space().startRun({
			projectId,
			flow: flow(
				[gate, command("there", "echo from B")],
				[{ id: "e1", from: "gate", outcome: "yes", to: "there" }],
			),
			startedBy: personId,
			deviceId: B,
		});
		const stepId = await openGate(started.id);
		// This computer forgets the Device (as a Device in a Host's Space
		// never lists it), and starts again.
		await a.db.delete(deviceTable).where(eq(deviceTable.id, B));
		lifetime.abort();
		await engine.dispose();
		engine = peerEngine();
		online.delete(B);
		await space().resolveGate({ runId: started.id, stepId, choice: "yes" });
		await until(started.id, "sleeping");
		const waited = (await a.db.select().from(event)).find(
			(e) => e.type === "WaitStarted",
		);
		expect(JSON.parse(waited?.payload ?? "{}")).toMatchObject({
			reason: "device-offline",
			deviceId: B,
			deviceName: "studio-b",
			message: "studio-b is offline. The step starts when it is back.",
		});
		online.add(B);
		await engine.deviceBack(B);
		const run = await until(started.id, "finished");
		expect(String(run.steps[1]?.outputs.log_tail).trim()).toBe("from B");
	}, 30_000);

	test("a run from before the plan kept names walks: its node runs on the Device it named", async () => {
		await shareRemote();
		const started = await space().startRun({
			projectId,
			flow: gateThenB,
			startedBy: personId,
		});
		const stepId = await openGate(started.id);
		await a.db
			.update(runTable)
			.set({ deviceNames: null })
			.where(eq(runTable.id, started.id));
		await space().resolveGate({ runId: started.id, stepId, choice: "yes" });
		const run = await until(started.id, "finished");
		expect(run.steps.map((s) => [s.nodeId, s.outcome, s.device?.id])).toEqual([
			["gate", "yes", expect.any(String)],
			["there", "pass", B],
		]);
		expect(String(run.steps[1]?.outputs.log_tail).trim()).toBe("from B");
	});

	test("a move goes to one of the Person's own Devices, online, and keeps the plan", async () => {
		await shareRemote();
		const started = await space().startRun({
			projectId,
			flow: gateThenB,
			startedBy: personId,
		});
		await openGate(started.id);
		await expect(space().moveRun(started.id, "device-c")).rejects.toThrow(
			"That device is not one of yours.",
		);
		online.delete(B);
		await expect(space().moveRun(started.id, B)).rejects.toThrow(
			"studio-b is offline. Move the run when it is online.",
		);
		await space().stopRun(started.id);
	});
});

describe("the Space's profiles", () => {
	test("this computer lists its own profiles, another of the Person's Devices those of its document copy, and another Person's its offered ones", async () => {
		const devices = () => space().listDevices(projectId);
		// No copy of B's Device document here: its profiles are unknown.
		expect((await devices()).map((d) => [d.name, d.profiles])).toEqual([
			[expect.any(String), A_PROFILES],
			["studio-b", undefined],
		]);

		const copy = new Y.Doc();
		copy.getMap("profiles").set("p-1", {
			name: "builder",
			description: null,
			settings: PROFILE,
			updatedAt: 1,
		});
		await documentRows(a.db).store(
			deviceDocumentName(B),
			Y.encodeStateAsUpdate(copy),
		);
		const document = await documents.open(a.spaceId);
		await document.change(() => {
			document.offers.set("device-c/p-2", {
				deviceId: "device-c",
				deviceName: "laptop-c",
				profile: "p-2",
				profileName: "coder",
				permissionCap: "acceptEdits",
				sessionCap: 1,
				offeredAt: 1,
				by: "someone-else",
			});
		});
		expect(
			(await devices()).map((d) => [d.name, d.offers, d.profiles]),
		).toEqual([
			[expect.any(String), undefined, A_PROFILES],
			["studio-b", undefined, [{ id: "p-1", name: "builder", kind: "agent" }]],
			["laptop-c", ["coder"], [{ id: "p-2", name: "coder", kind: "agent" }]],
		]);
	});
});

describe("the owner's other Devices in a Space of the home Host", () => {
	const SPACE = "space-on-h";
	const HOST = "host-h";
	/** This computer's Person, as the home Host knows them. */
	const ON_HOST = "person-on-h";
	const LAPTOP_PROFILES = [
		{ id: "p-l", name: "builder", kind: "agent" as const },
	];

	/** B in a Space its Host keeps, with a copy of its owner's laptop's document. */
	async function deviceInHostSpace(options: {
		role?: "home" | "guest";
		devices?: () => Promise<OwnDevice[]>;
	}) {
		await b.db.insert(hostLink).values({
			hostId: HOST,
			name: "H",
			addresses: "[]",
			role: options.role ?? "home",
			personId: ON_HOST,
			keyStore: "file",
		});
		const [local] = await b.db.select().from(user);
		await createHostSpaces(b.db).update(
			{ id: HOST, name: "H" },
			[{ id: SPACE, name: "Personal", personal: true, role: "owner" }],
			local?.id as string,
		);
		const spaceDocuments = createSpaceDocuments({
			db: b.db,
			directory: deviceDirectory(b.db),
		});
		const document = await spaceDocuments.open(SPACE);
		await document.change(() => {
			recordClone(document, {
				projectId: "p-shared",
				deviceId: "laptop",
				deviceName: "laptop.local",
			});
		});
		const placement = createPlacement({
			db: b.db,
			device: testDevice({ harnesses: {} }, b.deviceId),
			log: { walkerId: async () => b.deviceId } as never,
			registry: {} as never,
			documents: spaceDocuments,
			hostSpaces: createHostSpaces(b.db),
			project: async () => ({ repoPath: null }) as ListedProject,
			flows: async () => ({}),
			relay: {
				devices: async () => {
					if (!options.devices) throw new HostUnreachableError();
					return options.devices();
				},
			} as unknown as HostRelay,
			copies: {
				list: async () => [
					{
						deviceId: "laptop",
						name: "Laptop",
						platform: "darwin",
						profiles: LAPTOP_PROFILES,
						secrets: [{ name: "GH_TOKEN", setAt: 1 }],
						checkedAt: 1,
					},
				],
			},
		});
		return { placement, spaceDocuments };
	}

	test("while the Host cannot be reached, they are listed offline with the name and profiles of their copy", async () => {
		const { placement, spaceDocuments } = await deviceInHostSpace({});
		const devices = await placement.devicesFor(SPACE, ON_HOST, "p-shared");
		expect(devices.slice(1)).toEqual([
			{
				deviceId: "laptop",
				name: "Laptop",
				thisDevice: false,
				online: false,
				hasClone: true,
				profiles: LAPTOP_PROFILES,
			},
		]);
		// A node that names it waits for it, instead of a refusal.
		const named = (await placement.namesFor(SPACE, ON_HOST, "p-shared"))(
			"Laptop",
		);
		expect(named).toMatchObject({ deviceId: "laptop", online: false });
		await spaceDocuments.close();
	});

	test("a Host that cannot tell a Device's profiles gets them from the copy; another Person's offered ones stay", async () => {
		const { placement, spaceDocuments } = await deviceInHostSpace({
			devices: async () => [
				{
					deviceId: "laptop",
					name: "Laptop",
					thisDevice: false,
					online: true,
					hasClone: true,
				},
				{
					deviceId: "theirs",
					name: "Theirs",
					thisDevice: false,
					online: true,
					hasClone: true,
					offers: ["coder"],
				},
			],
		});
		const devices = await placement.devicesFor(SPACE, ON_HOST, "p-shared");
		expect(devices.slice(1).map((d) => [d.deviceId, d.profiles])).toEqual([
			["laptop", LAPTOP_PROFILES],
			["theirs", undefined],
		]);
		await spaceDocuments.close();
	});

	test("never for another Person, and never in a Space of a Guest Host", async () => {
		const own = await deviceInHostSpace({});
		expect(
			(await own.placement.devicesFor(SPACE, "someone-else", "p-shared")).slice(
				1,
			),
		).toEqual([]);
		await own.spaceDocuments.close();

		await b.db.delete(hostLink);
		const guest = await deviceInHostSpace({ role: "guest" });
		expect(
			(await guest.placement.devicesFor(SPACE, ON_HOST, "p-shared")).slice(1),
		).toEqual([]);
		await guest.spaceDocuments.close();
	});
});

describe("the name of a Device", () => {
	const own = (name: string, deviceId = name) => ({
		deviceId,
		name,
		thisDevice: false,
		online: true,
		hasClone: true,
	});
	const offered = (name: string, deviceId = name) => ({
		...own(name, deviceId),
		offers: ["coder"],
	});

	test("picks one of the Person's own over another Person's, and nothing when none has it", () => {
		expect(
			deviceNamed(
				[offered("studio", "theirs"), own("studio", "mine")],
				"studio",
			)?.deviceId,
		).toBe("mine");
		expect(deviceNamed([offered("studio")], "studio")?.deviceId).toBe("studio");
		// Of two other people's, this computer.
		expect(
			deviceNamed(
				[
					offered("studio", "theirs"),
					{ ...offered("studio", "here"), thisDevice: true },
				],
				"studio",
			)?.deviceId,
		).toBe("here");
		expect(deviceNamed([own("studio")], "laptop")).toBeNull();
		expect(() =>
			deviceNamed([own("studio", "one"), own("studio", "two")], "studio"),
		).toThrow('Two of your devices are named "studio".');
	});
});

describe("the walk, from the plan alone", () => {
	/** A's placement module, with no registry and no names it learned. */
	const placementOfA = () =>
		createPlacement({
			db: a.db,
			device: testDevice({ harnesses: {} }, a.deviceId),
			log: { walkerId: async () => a.deviceId } as never,
			registry: {} as never,
			documents,
			hostSpaces: createHostSpaces(a.db),
			project: async () => {
				throw new Error("No project here.");
			},
			flows: async () => ({}),
			work,
		});
	const row = (fields: object) =>
		placedRun({
			id: "a-run",
			spaceId: a.spaceId,
			projectId,
			walkerId: a.deviceId,
			deviceId: B,
			placements: JSON.stringify({ "hetzner-1": "device-h" }),
			deviceNames: JSON.stringify({ [B]: "studio-b", "device-h": "hetzner-1" }),
			startedBy: personId,
			...fields,
		} as Parameters<typeof placedRun>[0]);

	test("names each Device as the plan does, with no warm-up", () => {
		const placement = placementOfA();
		expect(placement.deviceFor(command("x", "true"), row({})).name).toBe(
			"studio-b",
		);
		expect(
			placement.deviceFor(
				{
					...command("y", "true"),
					device: "hetzner-1",
				} as Flow["nodes"][number],
				row({}),
			).name,
		).toBe("hetzner-1");
	});

	test("a run from before the plan kept names: by the node's name, and before Placement on its Walker", () => {
		const placement = placementOfA();
		const older = row({ deviceNames: null });
		const named = placement.deviceFor(
			{ ...command("y", "true"), device: "hetzner-1" } as Flow["nodes"][number],
			older,
		);
		expect([named.id, named.name]).toEqual(["device-h", "hetzner-1"]);
		expect(placement.deviceFor(command("x", "true"), older).id).toBe(B);
		expect(
			placement.deviceFor(
				command("x", "true"),
				row({ deviceId: null, placements: null, deviceNames: null }),
			).id,
		).toBe(a.deviceId);
	});

	const agentOn = (device: string, profile = "builder") =>
		({
			id: "work",
			type: "agent",
			position: { x: 0, y: 0 },
			prompt: "Work.",
			profile: { device, profile },
		}) as Flow["nodes"][number];

	test("a node with a profile runs on its profile's Device by id: two Devices of one name keep their own steps", () => {
		const placement = placementOfA();
		const twins = row({
			placements: null,
			deviceNames: JSON.stringify({
				[B]: "studio-b",
				"twin-a": "twin",
				"twin-b": "twin",
			}),
		});
		const first = placement.deviceFor(agentOn("twin-a"), twins);
		const second = placement.deviceFor(agentOn("twin-b"), twins);
		expect([first.id, first.name]).toEqual(["twin-a", "twin"]);
		expect([second.id, second.name]).toEqual(["twin-b", "twin"]);
		expect(placement.deviceFor(agentOn(a.deviceId), twins).id).toBe(a.deviceId);
	});

	test("a run planned before steps were placed by id still reads: its copy names the profile's Device by name too", () => {
		const placement = placementOfA();
		const older = row({});
		const node = {
			...agentOn("device-h"),
			device: "hetzner-1",
		} as Flow["nodes"][number];
		const at = placement.deviceFor(node, older);
		expect([at.id, at.name]).toEqual(["device-h", "hetzner-1"]);
	});
});

describe("a run with no starter", () => {
	test("sends nothing to another Device: its calls there are refused here", async () => {
		const placement = createPlacement({
			db: a.db,
			device: testDevice({ harnesses: {} }, a.deviceId),
			log: { walkerId: async () => a.deviceId } as never,
			registry: {} as never,
			documents,
			hostSpaces: createHostSpaces(a.db),
			project: async () => {
				throw new Error("No project here.");
			},
			flows: async () => ({}),
			work,
		});
		// A run from before every run had a starter, moved here.
		const there = placement.deviceById(
			B,
			placedRun({
				id: "older-run",
				spaceId: a.spaceId,
				projectId,
				walkerId: a.deviceId,
				deviceId: B,
				startedBy: null,
			} as Parameters<typeof placedRun>[0]),
		);
		const events = [];
		for await (const event of there.exec({
			command: "true",
			cwd: b.repoPath,
			signal: new AbortController().signal,
		})) {
			events.push(event);
		}
		expect(events).toEqual([
			{ type: "exit", exitCode: null, spawnError: NO_STARTER },
		]);
		expect(requests).toEqual([]);
	});
});

describe("a scheduled run with a node on another of the Person's Devices", () => {
	const TICK_MS = 5;
	/** Local time, October 2026. */
	const at = (day: number, hours: number, minutes = 0, seconds = 0) =>
		new Date(2026, 9, day, hours, minutes, seconds).getTime();
	let clock: number;

	beforeEach(() => {
		// A fires the project's schedules, on its own clock.
		lifetime.abort();
		clock = at(16, 21, 59);
		engine = peerEngine({ now: () => clock, scheduleTickMs: TICK_MS });
	});
	afterEach(() => Bun.sleep(TICK_MS * 4));

	test("runs that node there, as the run of the Person the schedule runs for", async () => {
		await a.db.insert(clone).values({
			id: "clone-a",
			spaceId: a.spaceId,
			projectId,
			deviceId: a.deviceId,
			path: a.repoPath,
		});
		const remote = join(a.root, "remote.git");
		await mustGit(a.root, ["init", "-q", "--bare", remote]);
		await mustGit(a.repoPath, ["remote", "add", "origin", remote]);
		await mustGit(b.repoPath, ["remote", "add", "origin", remote]);
		// The schedule names no Person: it fires here, for A's owner.
		await seedFlows(
			engine.space(a.spaceId),
			projectId,
			{
				night: flow([
					{ ...command("there", "echo from B"), device: "studio-b" },
				] as Flow["nodes"]),
			},
			[
				{
					id: "nightly",
					flow: "night",
					inputs: {},
					cron: "0 22 * * *",
					enabled: true,
				},
			],
		);
		await Bun.sleep(TICK_MS * 4);
		clock = at(16, 22, 0, 20);
		const scheduled = await waitFor(
			async () => (await engine.space(a.spaceId).listRuns())[0],
			{ label: "the scheduled run", timeoutMs: 10_000 },
		);
		expect(scheduled.trigger.kind).toBe("schedule");
		expect(scheduled.startedBy?.id).toBe(personId);

		const run = await until(scheduled.id, "finished");
		expect(run.steps.map((s) => [s.nodeId, s.outcome, s.device?.id])).toEqual([
			["there", "pass", B],
		]);
		expect(String(run.steps[0]?.outputs.log_tail).trim()).toBe("from B");
		// Every call B took named the run's starter.
		expect(requests.length).toBeGreaterThan(0);
		for (const request of requests) expect(request.personId).toBe(personId);
	}, 30_000);

	test("a schedule that names no Device runs where a person's start would: on B, when A has no Clone", async () => {
		// A Device saved the schedule; A's own folder of the project went since.
		await a.db.insert(clone).values({
			id: "clone-a",
			spaceId: a.spaceId,
			projectId,
			deviceId: a.deviceId,
			path: a.repoPath,
		});
		await seedFlows(
			engine.space(a.spaceId),
			projectId,
			{ night: flow([command("hello", "echo from B")]) },
			[
				{
					id: "nightly",
					flow: "night",
					inputs: {},
					cron: "0 22 * * *",
					enabled: true,
				},
			],
		);
		await a.db.delete(clone).where(eq(clone.id, "clone-a"));
		await Bun.sleep(TICK_MS * 4);
		clock = at(16, 22, 0, 20);
		const scheduled = await waitFor(
			async () => (await engine.space(a.spaceId).listRuns())[0],
			{ label: "the scheduled run", timeoutMs: 10_000 },
		);
		expect(scheduled.trigger.kind).toBe("schedule");
		expect(scheduled.device).toMatchObject({ id: B, thisDevice: false });
		const run = await until(scheduled.id, "finished");
		expect(String(run.steps[0]?.outputs.log_tail).trim()).toBe("from B");
	}, 30_000);
});

describe("a run in the Personal of another Person whose home Host this is", () => {
	const ADA = "ada";
	const ADA_SPACE = "personal-ada";
	/** This computer's Offers, as its Device document keeps them. */
	let offered: DeviceOffer[];
	let adaProject: string;
	/** The name of this computer's owner: the Host admin. */
	let adminName: string;

	beforeEach(async () => {
		await a.db
			.insert(user)
			.values({ id: ADA, name: "Ada", email: "ada@example.invalid" });
		await a.db.insert(organization).values({
			id: ADA_SPACE,
			name: "Personal",
			slug: ADA_SPACE,
			personal: true,
			createdAt: new Date(),
		});
		await a.db.insert(member).values({
			id: "m-ada",
			organizationId: ADA_SPACE,
			userId: ADA,
			role: "owner",
			createdAt: new Date(),
		});
		await engine.devices.join({
			id: "ada-laptop",
			name: "ada-laptop",
			platform: "darwin",
			ownerId: ADA,
			homeHost: "https://host.invalid",
		});
		adminName = "Sander";
		await a.db
			.update(user)
			.set({ name: adminName })
			.where(eq(user.id, personId));
		// The Host's engine, with its own Offers.
		lifetime.abort();
		offered = [];
		engine = peerEngine(undefined, {
			deviceId: a.deviceId,
			ownOffers: () => offered,
			mayUseOffers: async () => true,
		});
		// Ada's project, with a Clone on the Host.
		adaProject = (
			await engine.space(ADA_SPACE).addProject({ repoPath: b.repoPath })
		).id;
	});

	const onHost = (): Flow =>
		flow([
			{
				id: "work",
				type: "agent",
				position: { x: 0, y: 0 },
				prompt: "Work.",
				profile: { device: a.deviceId, profile: "everywhere" },
			} as Flow["nodes"][number],
		]);
	const start = () =>
		engine
			.space(ADA_SPACE, { personId: ADA })
			.startRun({ projectId: adaProject, flow: onHost(), startedBy: ADA });
	const refusal = () =>
		`The Host test belongs to ${adminName}. Ask them to offer its profiles to your Personal, or pick one of your own devices.`;

	async function offer() {
		await engine.offers.publish({
			spaceId: ADA_SPACE,
			deviceId: a.deviceId,
			deviceName: "test",
			profile: "everywhere",
			profileName: "everywhere",
			permissionCap: "auto",
			sessionCap: 1,
			by: personId,
		});
		offered = [
			{
				spaceId: ADA_SPACE,
				profile: "everywhere",
				profileName: "everywhere",
				permissionCap: "auto",
				sessionCap: 1,
				offeredAt: 1,
			},
		];
	}

	test("Ada's places name the Host admin on the Host", async () => {
		const places = await engine
			.space(ADA_SPACE, { personId: ADA })
			.listPlacements(adaProject);
		expect(places.find((p) => p.deviceId === a.deviceId)).toMatchObject({
			thisDevice: true,
			offers: [],
			ownerName: adminName,
		});
	});

	test("without an Offer, the run is refused: the Host is the admin's, and Ada learns what to do", async () => {
		await expect(start()).rejects.toThrow(refusal());
		expect(await engine.space(ADA_SPACE).listRuns()).toEqual([]);
	});

	test("the admin offers a profile to Ada's Personal: her run uses it on the Host", async () => {
		await offer();
		const started = await start();
		const run = await waitFor(
			async () => {
				const found = await engine.space(ADA_SPACE).getRun(started.id);
				return found.status === "finished" ? found : null;
			},
			{ label: "run finished", timeoutMs: 10_000 },
		);
		expect(run.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["work", "pass"],
		]);
		expect(run.device.id).toBe(a.deviceId);
	});

	test("withdrawn, the next run is refused again with the same words", async () => {
		await offer();
		await engine.offers.withdraw({
			spaceId: ADA_SPACE,
			deviceId: a.deviceId,
			profile: "everywhere",
			by: personId,
		});
		offered = [];
		await expect(start()).rejects.toThrow(refusal());
	});

	test("a command on the Host is refused even with an Offer: an Offer runs only its profile", async () => {
		await offer();
		await expect(
			engine.space(ADA_SPACE, { personId: ADA }).startRun({
				projectId: adaProject,
				flow: flow([command("hi", "echo hi")]),
				startedBy: ADA,
			}),
		).rejects.toThrow("test is not your device. It runs only Agent nodes");
	});

	test("started without a Device, it goes to Ada's own laptop with the project, not the Host that offers her nothing", async () => {
		const document = await documents.open(ADA_SPACE);
		await document.change(() =>
			recordClone(document, {
				projectId: adaProject,
				deviceId: "ada-laptop",
				deviceName: "ada-laptop",
			}),
		);
		online.add("ada-laptop");
		// B's fake serves the laptop's calls, from Ada's folder.
		projectId = adaProject;
		const hello = flow([command("hello", "echo hello")]);
		const ada = engine.space(ADA_SPACE, { personId: ADA });
		const started = await ada.startRun({
			projectId: adaProject,
			flow: hello,
			startedBy: ADA,
		});
		expect(started.device).toMatchObject({ id: "ada-laptop" });
		await waitFor(
			async () => {
				const run = await ada.getRun(started.id);
				return run.status === "finished" ? run : null;
			},
			{ label: "run finished", timeoutMs: 10_000 },
		);
		// Through an Offer the Host is hers to use: it stays the default.
		await offer();
		const onHostToo = await ada.startRun({
			projectId: adaProject,
			flow: onHost(),
			startedBy: ADA,
		});
		expect(onHostToo.device).toMatchObject({ id: a.deviceId });
	});
});
