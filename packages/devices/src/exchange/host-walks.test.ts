import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { event, keptVariable, user } from "@nightshift/db/schema";
import type { RunStatus } from "@nightshift/engine";
import {
	createSandbox,
	type Sandbox,
	seedFlows,
	testDevice,
	waitFor,
} from "@nightshift/engine/testing";
import type { Flow } from "@nightshift/flows";
import { eq } from "drizzle-orm";
import type { WorkRelay } from "../contract";
import { httpsLink } from "../links/link";
import type { PeerEngine } from "../peers";
import { type PairedReplicas, pairedReplicas } from "../testing";
import { serveWork } from "../work";
import { createDeviceExchange, type DeviceExchange } from "./device-exchange";

/**
 * The Host walks the runs a Device starts (ADR 1, decision 9), in one
 * process: B starts a run in A's Space, A walks it, and its unplaced
 * steps run on B over an in-memory work relay. B gets the run, and the
 * kept values A's walk saved, by its exchange.
 */

let a: Sandbox;
let b: Sandbox;
let paired: PairedReplicas;
let exchange: DeviceExchange;
let projectId: string;
let stop: () => Promise<void>;

/** One command that counts its runs in a kept variable. */
const countFlow = {
	version: 7,
	inputs: [],
	outputs: [],
	start: "count",
	variables: [{ name: "runs", type: "number", initial: "0", keep: "project" }],
	nodes: [
		{
			id: "count",
			type: "command",
			position: { x: 0, y: 0 },
			command: "pwd",
			output: "text",
			set: [{ variable: "runs", expression: "vars.runs + 1" }],
		},
	],
	edges: [],
} as Flow;

beforeEach(async () => {
	[a, b] = await Promise.all([createSandbox(), createSandbox()]);
	const onB = testDevice(
		{
			harnesses: {},
			clonePath: async (id) => (id === projectId ? b.repoPath : null),
		},
		b.deviceId,
	);
	const work: WorkRelay = {
		online: (id) => id === b.deviceId,
		async *call(id, request, signal) {
			if (id !== b.deviceId) {
				yield { kind: "error", message: "offline", offline: true };
				return;
			}
			yield* serveWork(onB, request, signal ?? new AbortController().signal);
		},
	};
	paired = await pairedReplicas(a, b, { hostWalks: true, hostWork: work });
	projectId = (
		await paired.host.space(a.spaceId).addProject({ repoPath: a.repoPath })
	).id;
	await paired.projectOnDevice(projectId, { clone: true });
	await paired.hostExchange.addClone(paired.key, {
		spaceId: a.spaceId,
		projectId,
		deviceName: "B",
	});
	await seedFlows(paired.host.space(a.spaceId), projectId, {
		count: countFlow,
	});
	exchange = createDeviceExchange({
		engine: paired.device,
		hostId: paired.hostId,
		selfId: b.deviceId,
		projectWaitMs: 5_000,
		idleMs: 1_000,
	});
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
		clientFor: () => paired.memory.client(paired.key),
		heartbeatMs: 20,
		firstBackoffMs: 5,
		maxBackoffMs: 20,
		streamBackoff: { firstMs: 5, maxMs: 20 },
	});
	const detach = exchange.attach(link);
	stop = async () => {
		detach();
		await link.close();
	};
});

afterEach(async () => {
	await stop();
	await Promise.all([a.cleanup(), b.cleanup()]);
});

async function statusOn(engine: PeerEngine, runId: string) {
	try {
		return (await engine.space(a.spaceId).getRun(runId)).status;
	} catch {
		return null;
	}
}

function untilStatus(engine: PeerEngine, runId: string, status: RunStatus) {
	return waitFor(async () => (await statusOn(engine, runId)) === status, {
		label: `status ${status}`,
		timeoutMs: 15_000,
	});
}

async function keptOn(sandbox: Sandbox) {
	return (
		await sandbox.db
			.select()
			.from(keptVariable)
			.where(eq(keptVariable.projectId, projectId))
	).map((row) => [row.name, row.value]);
}

describe("the Host walks a run a Device starts", () => {
	test("A walks it, its unplaced steps run on B, and B gets the run and its kept value", async () => {
		const started = await paired.device
			.space(a.spaceId, { personId: paired.personId })
			.startRun({ projectId, flowName: "count" });
		expect(started.walker).toMatchObject({ id: a.deviceId, thisDevice: false });
		expect(started.device).toMatchObject({ id: b.deviceId, thisDevice: true });

		await untilStatus(paired.host, started.id, "finished");
		await untilStatus(paired.device, started.id, "finished");
		const detail = await paired.device.space(a.spaceId).getRun(started.id);
		expect(detail.steps.map((s) => [s.nodeId, s.device?.id])).toEqual([
			["count", b.deviceId],
		]);
		// The command ran in B's copy of the project.
		expect(String(detail.steps[0]?.outputs.log_tail).trim()).toBe(
			started.worktreePath,
		);
		// Every event is A's: B walked nothing.
		const walkers = (
			await b.db.select().from(event).where(eq(event.runId, started.id))
		).map((e) => e.walkerId);
		expect(new Set(walkers)).toEqual(new Set([a.deviceId]));

		// The kept value A's walk saved is B's too, for a run B walks itself.
		expect(await keptOn(a)).toEqual([["runs", "1"]]);
		await waitFor(async () => (await keptOn(b)).length > 0, {
			label: "the kept value on B",
		});
		expect(await keptOn(b)).toEqual([["runs", "1"]]);
	});

	test("B names the Person who started a run on the Host, from the Members of the Space", async () => {
		// The Host's Person, as the Space document B keeps a copy of names them.
		const mirror = await paired.documents.open(a.spaceId);
		await mirror.change(() =>
			mirror.members.set(paired.personId, { name: "Ada", role: "owner" }),
		);
		// B has no account of the Host's Person: only the Space's Members name them.
		expect(
			await b.db.select().from(user).where(eq(user.id, paired.personId)),
		).toEqual([]);
		const started = await paired.host
			.space(a.spaceId, { personId: paired.personId })
			.startRun({ projectId, flowName: "count", deviceId: b.deviceId });
		await untilStatus(paired.device, started.id, "finished");
		const expected = { id: paired.personId, name: "Ada" };
		expect(
			(await paired.device.space(a.spaceId).getRun(started.id)).startedBy,
		).toEqual(expected);
		const listed = (await paired.device.space(a.spaceId).listRuns()).find(
			(r) => r.id === started.id,
		);
		expect(listed?.startedBy).toEqual(expected);
	});

	test("a value kept here later than the step ended stays", async () => {
		// B saved a value later than A's step will end, as a run it walked would.
		await b.db.insert(keptVariable).values({
			spaceId: a.spaceId,
			projectId,
			flowName: "count",
			name: "runs",
			value: "7",
			runId: "a-run-of-b",
			stepId: "a-step-of-b",
			updatedAt: new Date(Date.now() + 60_000),
		});
		const started = await paired.device
			.space(a.spaceId, { personId: paired.personId })
			.startRun({ projectId, flowName: "count" });
		await untilStatus(paired.device, started.id, "finished");
		expect(await keptOn(a)).toEqual([["runs", "1"]]);
		expect(await keptOn(b)).toEqual([["runs", "7"]]);
	});
});
