import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import {
	clone,
	device as deviceTable,
	event,
	organization,
	run as runTable,
} from "@nightshift/db/schema";
import {
	createSpaceDocuments,
	planOf,
	type RunStatus,
	recordClone,
	type SpaceDocuments,
} from "@nightshift/engine";
import {
	createSandbox,
	mustGit,
	type Sandbox,
	testDevice,
	waitFor,
} from "@nightshift/engine/testing";
import type { Flow } from "@nightshift/flows";
import { writeFlowFile, writeSchedulesFile } from "@nightshift/flows/files";
import { and, eq } from "drizzle-orm";
import {
	type WorkRelay,
	type WorkRequest,
	workRequestSchema,
} from "../contract";
import { createHostSpaces } from "../links";
import { NO_STARTER } from "../offers";
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

/** A's engine. Without `internals`, it fires no schedules. */
function peerEngine(
	internals?: Parameters<typeof createPeerEngine>[1],
): PeerEngine {
	lifetime = new AbortController();
	return createPeerEngine(
		withPeers({
			db: a.db,
			dataDir: a.dataDir,
			...(internals ? {} : { scheduler: false as const }),
			harnesses: { "claude-code": fakeHarness(reportingScript("pass")) },
			profileFor: (name) =>
				name === "everywhere" || name === "here_only" ? PROFILE : null,
			spaceDocuments: documents,
			work,
		}),
		{ ...internals, signal: lifetime.signal },
	);
}

const flow = (nodes: Flow["nodes"], edges: Flow["edges"] = []): Flow =>
	({
		version: 5,
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
		expect(requests.map((r) => r.call.kind)).toEqual(
			expect.arrayContaining([
				"flows",
				"capabilities",
				"worktree",
				"exec",
				"session",
			]),
		);
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

	test("the flows come from that Device's Clone, and the project is renamed without one here", async () => {
		await mkdir(join(b.repoPath, ".nightshift", "flows"), { recursive: true });
		await writeFile(
			join(b.repoPath, ".nightshift", "flows", "hello.json"),
			JSON.stringify(flow([command("hi", "echo hi")])),
		);
		expect(await space().listPlacements(projectId)).toEqual([
			{ deviceId: B, name: "studio-b", thisDevice: false },
		]);
		expect((await space().listFlows(projectId)).map((f) => f.name)).toEqual([
			"hello",
		]);
		expect(
			(await space().getFlow(projectId, "hello")).flow?.nodes,
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

	test("refusals name the Device: what it lacks, offline, not the starter's, no Clone", async () => {
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

		online.delete(B);
		await expect(
			space().startRun({
				projectId,
				flow: flow([command("hi", "echo hi")]),
				startedBy: personId,
				deviceId: B,
			}),
		).rejects.toThrow("studio-b is offline.");
		expect(await space().listPlacements(projectId)).toEqual([]);
		online.add(B);

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
			message: "studio-b is offline. The step starts when it is back.",
		});
		online.add(B);
		await engine.deviceBack(B);
		const run = await until(started.id, "finished");
		expect(String(run.steps[1]?.outputs.log_tail).trim()).toBe("from B");
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

	test("a node's profile picks its Device: the run's when it has it, else this computer", async () => {
		await shareRemote();
		const profiled = (id: string, profile: string) =>
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
				[profiled("there", "everywhere"), profiled("here", "here_only")],
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
		// The snapshot names this computer for the node only it can run.
		expect(
			run.flow.nodes.map((n) => ("device" in n ? n.device : null)),
		).toEqual([null, "test"]);
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
		expect(planOf(row)).toEqual({
			device: { id: started.device.id, name: "test" },
			named: { "studio-b": { id: B, name: "studio-b" } },
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
			work,
		});
	const row = (fields: object) =>
		({
			id: "a-run",
			spaceId: a.spaceId,
			projectId,
			walkerId: a.deviceId,
			deviceId: B,
			placements: JSON.stringify({ "hetzner-1": "device-h" }),
			deviceNames: JSON.stringify({ [B]: "studio-b", "device-h": "hetzner-1" }),
			startedBy: personId,
			...fields,
		}) as Parameters<ReturnType<typeof createPlacement>["deviceFor"]>[1];

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
			work,
		});
		// A run from before every run had a starter, moved here.
		const there = placement.deviceById(B, {
			id: "older-run",
			spaceId: a.spaceId,
			projectId,
			walkerId: a.deviceId,
			deviceId: B,
			startedBy: null,
		} as Parameters<typeof placement.deviceById>[1]);
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
		await writeFlowFile(
			a.repoPath,
			"night",
			flow([
				{ ...command("there", "echo from B"), device: "studio-b" },
			] as Flow["nodes"]),
		);
		// The schedule names no Person: it fires here, for A's owner.
		await writeSchedulesFile(a.repoPath, [
			{
				id: "nightly",
				flow: "night",
				inputs: {},
				cron: "0 22 * * *",
				enabled: true,
			},
		]);
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
});
