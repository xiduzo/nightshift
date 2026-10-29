import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedFlows } from "@nightshift/engine/testing";

import {
	type Daemon,
	pair,
	savesOn,
	startDaemon,
	stopDaemon,
	waitFor,
} from "../test-daemons";

/**
 * Who walks a run B starts, between two daemons (ADR 1, decisions 9 and
 * 10): A is the Host, B pairs with it and has a Clone. A walks the run,
 * and its unplaced steps run on B. While A is away, B walks the run
 * itself; A gets it, and the value it kept, when it is back. A run
 * started on A (a phone or a browser there) runs its steps on A, or, when
 * A has no copy of the project, where the project's last run ran.
 */

const root = mkdtempSync(join(tmpdir(), "nightshift-host-walks-"));
const REMOTE = "https://example.com/acme/walks.git";

let a: Daemon;
let b: Daemon;
let aId: string;
let bId: string;
let projectId: string;

async function repo(name: string): Promise<string> {
	const path = join(root, name);
	mkdirSync(path, { recursive: true });
	const git = async (...args: string[]) => {
		const child = Bun.spawn(
			[
				"git",
				"-c",
				"user.name=Night Shift Test",
				"-c",
				"user.email=test@nightshift.invalid",
				"-c",
				"commit.gpgsign=false",
				...args,
			],
			{ cwd: path, stdout: "ignore", stderr: "pipe" },
		);
		if ((await child.exited) !== 0) {
			throw new Error(await new Response(child.stderr).text());
		}
	};
	await Bun.write(join(path, "README.md"), `# ${name}\n`);
	await git("init", "-q", "-b", "main");
	await git("remote", "add", "origin", REMOTE);
	await git("add", "README.md");
	await git("commit", "-q", "-m", "initial");
	return path;
}

async function runOn(daemon: Daemon, runId: string) {
	return (await daemon.client.runs.list()).find((r) => r.id === runId);
}

async function keptOn(daemon: Daemon) {
	return daemon.client.flows.kept({ projectId, name: "count" });
}

beforeAll(async () => {
	[a, b] = await Promise.all([
		startDaemon(root, "a", { NIGHTSHIFT_HOST: "on" }),
		startDaemon(root, "b", {}),
	]);
	aId = (await a.client.devices.list()).thisComputer?.id as string;
	bId = await pair(a, b);
	await waitFor(
		async () => (await b.client.devices.list()).thisComputer?.hosts ?? [],
		(hosts) => hosts[0]?.status === "online",
	);
	projectId = (await a.client.projects.add({ repoPath: await repo("on-a") }))
		.id;
	const spaceId = (await a.client.spaces.list()).active as string;
	await waitFor(
		async () => (await b.client.spaces.list()).spaces,
		(spaces) => spaces.some((s) => s.id === spaceId),
	);
	await b.client.spaces.switch({ spaceId });
	const folder = await repo("on-b");
	await waitFor(
		() => b.client.projects.add({ repoPath: folder }).catch(() => null),
		(project) => project !== null,
	);
	// One command that counts the runs of the flow in a kept variable.
	await seedFlows(savesOn(a), projectId, {
		count: {
			version: 7,
			inputs: [],
			outputs: [],
			start: "count",
			variables: [
				{ name: "runs", type: "number", initial: "0", keep: "project" },
			],
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
		},
	});
	await waitFor(
		async () => (await b.client.flows.list({ projectId })).map((f) => f.name),
		(names) => names.includes("count"),
	);
}, 120_000);

afterAll(async () => {
	await Promise.all([stopDaemon(a), stopDaemon(b)]);
	rmSync(root, { recursive: true, force: true });
});

describe("who walks a run B starts", () => {
	test("A walks it, its step runs on B, and B gets the value it kept", async () => {
		const started = await b.client.runs.start({
			projectId,
			flowName: "count",
		});
		expect(started.walker).toMatchObject({ id: aId, thisDevice: false });
		expect(started.device).toMatchObject({ id: bId, thisDevice: true });
		await waitFor(
			() => runOn(b, started.id),
			(r) => r?.status === "finished",
			60_000,
		);
		const detail = await b.client.runs.get({ runId: started.id });
		expect(detail.steps.map((s) => s.device?.id)).toEqual([bId]);
		expect(String(detail.steps[0]?.outputs.log_tail).trim()).toBe(
			started.worktreePath,
		);
		const kept = await waitFor(
			() => keptOn(b),
			(values) => values.length > 0,
		);
		expect(kept.map((k) => [k.name, k.value])).toEqual([["runs", 1]]);
	}, 90_000);

	test("while A is away, B walks it itself, and A gets it and its kept value when it is back", async () => {
		await stopDaemon(a);
		await waitFor(
			async () => (await b.client.devices.list()).thisComputer?.hosts ?? [],
			(hosts) => hosts[0]?.status !== "online",
			30_000,
		);
		const started = await b.client.runs.start({
			projectId,
			flowName: "count",
		});
		expect(started.walker).toMatchObject({ id: bId, thisDevice: true });
		await waitFor(
			() => runOn(b, started.id),
			(r) => r?.status === "finished",
			30_000,
		);
		const onB = await keptOn(b);
		expect(onB.map((k) => [k.name, k.value])).toEqual([["runs", 2]]);

		a = await startDaemon(root, "a", a.env, a.port);
		const arrived = await waitFor(
			() => runOn(a, started.id),
			(r) => r?.status === "finished",
			60_000,
		);
		expect(arrived?.walker).toMatchObject({ id: bId, thisDevice: false });
		const onA = await waitFor(
			() => keptOn(a),
			(values) => values[0]?.value === 2,
		);
		expect(onA.map((k) => [k.name, k.value, k.runId])).toEqual([
			["runs", 2, started.id],
		]);
	}, 120_000);
});

describe("a run started on the Host, from a phone or a browser", () => {
	test("runs its steps on the Host when it has the project", async () => {
		const started = await a.client.runs.start({
			projectId,
			flowName: "count",
		});
		expect(started.walker).toMatchObject({ id: aId, thisDevice: true });
		expect(started.device).toMatchObject({ id: aId, thisDevice: true });
		await waitFor(
			() => runOn(a, started.id),
			(r) => r?.status === "finished",
			30_000,
		);
	}, 60_000);

	test("runs its steps where the project's last run ran when the Host has no copy of it", async () => {
		const fromB = await b.client.runs.start({ projectId, flowName: "count" });
		await waitFor(
			() => runOn(a, fromB.id),
			(r) => r?.status === "finished",
			30_000,
		);
		// A's own folder goes: only B has the project now.
		const db = new Database(join(a.dataDir, "nightshift.db"));
		db.run("delete from clone where project_id = ? and device_id = ?", [
			projectId,
			aId,
		]);
		db.close();

		expect(await a.client.runs.placements({ projectId })).toEqual([
			{
				deviceId: bId,
				name: expect.any(String),
				thisDevice: false,
				lastRun: true,
				default: true,
			},
		]);
		const started = await a.client.runs.start({
			projectId,
			flowName: "count",
		});
		expect(started.walker).toMatchObject({ id: aId, thisDevice: true });
		expect(started.device).toMatchObject({ id: bId, thisDevice: false });
		await waitFor(
			() => runOn(a, started.id),
			(r) => r?.status === "finished",
			30_000,
		);
	}, 90_000);
});
