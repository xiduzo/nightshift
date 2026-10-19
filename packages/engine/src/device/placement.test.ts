import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeHarness, reportingScript } from "@nightshift/agents/fake";
import { organization } from "@nightshift/db/schema/auth";
import { clone, device as deviceTable } from "@nightshift/db/schema/nightshift";
import type { Flow } from "@nightshift/flows";
import { and, eq } from "drizzle-orm";

import { createEngine } from "../engine";
import { createSpaceDocuments, recordClone } from "../space/document";
import {
	createSandbox,
	type Sandbox,
	testDevice,
	waitFor,
	withDevice,
} from "../test-support";
import type { Engine, RunStatus } from "../types";
import { serveWork, type WorkRelay, type WorkRequest } from "./remote";

/**
 * Run-level Placement in one process: A walks a run whose steps run on
 * Device B. A has no Clone of the project; B has. The work relay is
 * in-memory here (`serveWork` on B's local Device), the Host's hub in the
 * daemon.
 */

let a: Sandbox;
let b: Sandbox;
let engine: Engine;
let online: Set<string>;
let requests: WorkRequest[];
/** B's calls that are still running there. */
let running: number;
let personId: string;
let projectId: string;
const B = "device-b";

const bDevice = (projectOf: () => string) =>
	testDevice(
		{
			harnesses: { "claude-code": fakeHarness(reportingScript("pass")) },
			clonePath: async (id) => (id === projectOf() ? b.repoPath : null),
			findCli: (name) => (name === "git" ? "/usr/bin/git" : null),
		},
		B,
	);

beforeEach(async () => {
	[a, b] = await Promise.all([createSandbox(), createSandbox()]);
	online = new Set([B]);
	requests = [];
	running = 0;
	const onB = bDevice(() => projectId);
	const work: WorkRelay = {
		online: (id) => online.has(id),
		async *call(id, request, signal) {
			if (!online.has(id)) {
				yield { kind: "error", message: "offline" };
				return;
			}
			requests.push(request);
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
	const documents = createSpaceDocuments({ db: a.db });
	engine = createEngine(
		withDevice({
			db: a.db,
			dataDir: a.dataDir,
			scheduler: false,
			harnesses: {},
			spaceDocuments: documents,
			work,
		}),
	);
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
	await Promise.all([a.cleanup(), b.cleanup()]);
});

const flow = (nodes: Flow["nodes"], edges: Flow["edges"] = []): Flow =>
	({
		version: 4,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "a",
		nodes,
		edges,
	}) as Flow;

const command = (id: string, line: string) =>
	({
		id,
		type: "command",
		position: { x: 0, y: 0 },
		command: line,
		output: "text",
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
