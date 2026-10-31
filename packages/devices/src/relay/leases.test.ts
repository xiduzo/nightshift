import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runLease } from "@nightshift/db/schema";
import {
	createSandbox,
	type Sandbox,
	waitFor,
} from "@nightshift/engine/testing";
import type { Flow, FlowEdge, FlowNode, LeaseNode } from "@nightshift/flows";
import { applyRunCommand } from "../exchange/commands";
import { type PairedReplicas, pairedReplicas } from "../testing";

/**
 * Leases across the Devices of one Space (ADR 7): A is the Host that
 * keeps the Space and its leases, B a paired Device that walks its own
 * runs of A's Space. B takes, keeps and lets go of its leases at A.
 */

let a: Sandbox;
let b: Sandbox;
let paired: PairedReplicas;
let projectId: string;

beforeEach(async () => {
	[a, b] = await Promise.all([createSandbox(), createSandbox()]);
	paired = await pairedReplicas(a, b);
	projectId = (
		await paired.host.space(a.spaceId).addProject({ repoPath: a.repoPath })
	).id;
	await paired.projectOnDevice(projectId, { clone: true });
});
afterEach(async () => {
	await Promise.all([a, b].map((sandbox) => sandbox.cleanup()));
});

const at = { x: 0, y: 0 };
const lease: LeaseNode = {
	id: "own",
	type: "lease",
	position: at,
	name: "zac-docker-stack",
};
const edge = (from: string, outcome: string, to: string): FlowEdge => ({
	id: `${from}-${outcome}`,
	from,
	outcome,
	to,
});
const flowOf = (nodes: FlowNode[], edges: FlowEdge[]): Flow => ({
	version: 7,
	inputs: [],
	outputs: [],
	start: nodes[0]?.id ?? "",
	nodes,
	edges,
});

/** Takes the lease, then sleeps holding it until the signal `go`. */
const holding = flowOf(
	[
		lease,
		{
			id: "hold",
			type: "wait",
			position: at,
			until: { kind: "signal", name: "go" },
		},
	],
	[edge("own", "held", "hold")],
);

/** Takes the lease, and ends `nothing-to-do` when another run holds it. */
const polite = flowOf(
	[
		lease,
		{ id: "done", type: "end", position: at, status: "done" },
		{ id: "skip", type: "end", position: at, status: "nothing-to-do" },
	],
	[edge("own", "held", "done"), edge("own", "busy", "skip")],
);

/** The leases A keeps: name, run and the Device that renews it. */
async function leasesOnA() {
	return (await a.db.select().from(runLease)).map((row) => ({
		name: row.name,
		runId: row.runId,
		walkerId: row.walkerId,
	}));
}

async function statusOn(
	engine: PairedReplicas["host"],
	runId: string,
	status: string,
) {
	return waitFor(
		async () => {
			const detail = await engine.space(a.spaceId).getRun(runId);
			return detail.status === status ? detail : null;
		},
		{ label: `run ${runId} to be ${status}`, timeoutMs: 10_000 },
	);
}

describe("leases across Devices", () => {
	test("given a run A walks that holds a lease, when B's run takes it, then it is busy and names A's run", async () => {
		const first = await paired.host
			.space(a.spaceId)
			.startRun({ projectId, flow: holding });
		await statusOn(paired.host, first.id, "sleeping");

		const second = await paired.device
			.space(a.spaceId)
			.startRun({ projectId, flow: polite });
		const ended = await statusOn(paired.device, second.id, "finished");
		expect(ended.result).toBe("nothing-to-do");
		expect(ended.steps[0]?.outputs).toMatchObject({ holder: first.id });
	});

	test("given B's run takes a lease, then A keeps it for B, and lets go when B's run ends", async () => {
		const run = await paired.device
			.space(a.spaceId)
			.startRun({ projectId, flow: holding });
		await statusOn(paired.device, run.id, "sleeping");
		expect(await leasesOnA()).toEqual([
			{ name: "zac-docker-stack", runId: run.id, walkerId: b.deviceId },
		]);
		// B has no lease of its own for A's Space.
		expect(await b.db.select().from(runLease)).toEqual([]);

		await paired.device.space(a.spaceId).act(run.id, { kind: "stop" });
		await waitFor(async () => (await leasesOnA()).length === 0, {
			label: "A to let go of the lease",
		});
	});

	test("given a Device's run holds a lease at A, then another Device's key cannot renew or release it", async () => {
		const run = await paired.device
			.space(a.spaceId)
			.startRun({ projectId, flow: holding });
		await statusOn(paired.device, run.id, "sleeping");
		const c = await createSandbox();
		try {
			const other = await paired.pair(c, "C");
			await paired.hostExchange.leaseRelease(other.key, {
				spaceId: a.spaceId,
				runId: run.id,
			});
			expect(
				await paired.hostExchange.leaseRenew(other.key, {
					spaceId: a.spaceId,
					runId: run.id,
					names: ["zac-docker-stack"],
				}),
			).toEqual(["zac-docker-stack"]);
			expect(await leasesOnA()).toHaveLength(1);
		} finally {
			await c.cleanup();
		}
	});

	test("given B's run holds a lease, when B applies a person's release from A, then B logs it and A lets go", async () => {
		const run = await paired.device
			.space(a.spaceId)
			.startRun({ projectId, flow: holding });
		await statusOn(paired.device, run.id, "sleeping");
		await applyRunCommand(paired.device.space(a.spaceId), {
			kind: "lease.release",
			runId: run.id,
			payload: { name: "zac-docker-stack" },
		});
		await waitFor(async () => (await leasesOnA()).length === 0, {
			label: "A to let go of the lease",
		});
		expect(
			(await paired.device.space(a.spaceId).getRun(run.id)).leases,
		).toEqual([]);
	});
});
