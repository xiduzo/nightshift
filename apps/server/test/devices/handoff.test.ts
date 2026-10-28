import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
 * Per-node Placement between two daemons that share one git remote: A is
 * the Host, B paired with it, and both have a Clone of the project. A run
 * moves its work between them by the Hand-off (push, fetch, `HandedOff`);
 * a dirty worktree fails the step; B walks a run with a node on A through
 * A (the Walker → Host → Device leg); a node whose Device is offline sleeps
 * and continues when the Device is back.
 */

const root = realpathSync(mkdtempSync(join(tmpdir(), "nightshift-handoff-")));
const REMOTE = "https://example.com/acme/handoff.git";
const BARE = join(root, "remote.git");

let a: Daemon;
let b: Daemon;
let aName: string;
let bName: string;
let projectId: string;
let folderOnA: string;
let folderOnB: string;

function git(cwd: string, ...args: string[]) {
	const child = Bun.spawnSync(
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
		{ cwd, stdout: "ignore", stderr: "pipe" },
	);
	if (child.exitCode !== 0) throw new Error(child.stderr.toString());
}

function repo(name: string): string {
	const path = join(root, name);
	mkdirSync(path, { recursive: true });
	writeFileSync(join(path, "README.md"), `# ${name}\n`);
	git(path, "init", "-q", "-b", "main");
	git(path, "remote", "add", "origin", REMOTE);
	git(path, "add", "README.md");
	git(path, "commit", "-q", "-m", "initial");
	return path;
}

/** A flow of the project, saved on that daemon. */
async function flowIn(daemon: Daemon, name: string, nodes: unknown[]) {
	await seedFlows(savesOn(daemon), projectId, {
		[name]: {
			version: 7,
			inputs: [],
			outputs: [],
			start: (nodes[0] as { id: string }).id,
			nodes,
			edges: nodes.slice(1).map((node, i) => ({
				id: `e${i}`,
				from: (nodes[i] as { id: string }).id,
				outcome: "pass",
				to: (node as { id: string }).id,
			})),
		},
	});
}

const IDENTITY =
	"git -c user.name=Test -c user.email=test@nightshift.invalid -c commit.gpgsign=false";

/** A Command node that commits a new file and lists the folder. */
function commits(id: string, file: string, device?: string) {
	return {
		id,
		type: "command",
		position: { x: 0, y: 0 },
		command: `echo ${file} > ${file} && git add ${file} && ${IDENTITY} commit -q -m ${file} && ls`,
		output: "text",
		...(device ? { device } : {}),
	};
}

function shell(id: string, command: string, device?: string) {
	return {
		id,
		type: "command",
		position: { x: 0, y: 0 },
		command,
		output: "text",
		...(device ? { device } : {}),
	};
}

/** The `HandedOff` events of a run, as a Replica has them: from and to by name. */
function handOffs(daemon: Daemon, runId: string, ids: Record<string, string>) {
	const db = new Database(join(daemon.dataDir, "nightshift.db"), {
		readonly: true,
	});
	const rows = db
		.query(
			"select payload from event where run_id = ? and type = 'HandedOff' order by seq",
		)
		.all(runId) as { payload: string }[];
	db.close();
	return rows.map((r) => {
		const p = JSON.parse(r.payload) as { from: string; to: string };
		return [ids[p.from] ?? p.from, ids[p.to] ?? p.to];
	});
}

async function runOn(daemon: Daemon, runId: string) {
	return (await daemon.client.runs.list()).find((r) => r.id === runId);
}

beforeAll(async () => {
	git(root, "init", "-q", "--bare", BARE);
	[a, b] = await Promise.all([
		startDaemon(root, "a", { NIGHTSHIFT_HOST: "on" }),
		startDaemon(root, "b", {}),
	]);
	// Both run on this computer, with its name: B gets its own.
	await stopDaemon(b);
	const own = new Database(join(b.dataDir, "nightshift.db"));
	own.run("update device set name = 'studio-b' where self = 1");
	own.close();
	b = await startDaemon(root, "b", b.env, b.port);
	await pair(a, b);
	await waitFor(
		async () => (await b.client.devices.list()).thisComputer?.hosts ?? [],
		(hosts) => hosts[0]?.status === "online",
	);
	aName = (await a.client.devices.list()).thisComputer?.name as string;
	bName = (await b.client.devices.list()).thisComputer?.name as string;

	folderOnA = repo("on-a");
	projectId = (await a.client.projects.add({ repoPath: folderOnA })).id;
	const spaceId = (await a.client.spaces.list()).active as string;
	await waitFor(
		async () => (await b.client.spaces.list()).spaces,
		(spaces) => spaces.some((s) => s.id === spaceId),
	);
	await b.client.spaces.switch({ spaceId });
	folderOnB = repo("on-b");
	await waitFor(
		() => b.client.projects.add({ repoPath: folderOnB }).catch(() => null),
		(project) => project?.id === projectId,
	);
	// Both Clones push to and fetch from one shared remote.
	git(folderOnA, "remote", "set-url", "origin", BARE);
	git(folderOnB, "remote", "set-url", "origin", BARE);
	await waitFor(
		() => a.client.runs.placements({ projectId }),
		(list) => list.length === 2,
	);
}, 120_000);

afterAll(async () => {
	await Promise.all([stopDaemon(a), stopDaemon(b)]);
	rmSync(root, { recursive: true, force: true });
});

describe("nodes on two Devices", () => {
	test("A walks a run whose middle node runs on B: the work goes there and back", async () => {
		expect(aName).not.toBe(bName);
		await flowIn(a, "relay", [
			commits("one", "one.txt"),
			commits("two", "two.txt", bName),
			shell("three", "ls"),
		]);
		const started = await a.client.runs.start({
			projectId,
			flowName: "relay",
		});
		await waitFor(
			() => runOn(a, started.id),
			(r) => r?.status === "finished" || r?.status === "failed",
			60_000,
		);
		const detail = await a.client.runs.get({ runId: started.id });
		expect(detail.status).toBe("finished");
		const aId = detail.walker.id;
		const bId = detail.steps[1]?.device?.id as string;
		expect(detail.steps.map((s) => s.device?.thisDevice)).toEqual([
			true,
			false,
			true,
		]);
		// B had A's commit; A got B's back.
		expect(String(detail.steps[1]?.outputs.log_tail)).toContain("one.txt");
		expect(String(detail.steps[2]?.outputs.log_tail)).toContain("two.txt");
		expect(handOffs(a, started.id, { [aId]: "A", [bId]: "B" })).toEqual([
			["A", "B"],
			["B", "A"],
		]);
	}, 90_000);

	test("a dirty worktree fails the step that needs the work on the other Device", async () => {
		await flowIn(a, "dirty", [
			shell("scribble", "echo draft > draft.txt"),
			shell("there", "ls", bName),
		]);
		const started = await a.client.runs.start({
			projectId,
			flowName: "dirty",
		});
		await waitFor(
			() => runOn(a, started.id),
			(r) => r?.status === "failed",
			60_000,
		);
		const detail = await a.client.runs.get({ runId: started.id });
		expect(detail.steps[1]?.outcome).toBe("error");
		expect(detail.steps[1]?.error).toContain("not committed (draft.txt)");
	}, 90_000);

	test("B starts a run with a node on A: A walks it, and the work moves both ways", async () => {
		await flowIn(b, "visit", [
			commits("here", "here.txt"),
			commits("there", "there.txt", aName),
			shell("back", "ls"),
		]);
		// The Host walks it: the flow B saved reaches A first.
		await waitFor(
			async () => (await a.client.flows.list({ projectId })).map((f) => f.name),
			(names) => names.includes("visit"),
		);
		const started = await b.client.runs.start({
			projectId,
			flowName: "visit",
		});
		expect(started.walker.thisDevice).toBe(false);
		await waitFor(
			() => runOn(b, started.id),
			(r) => r?.status === "finished" || r?.status === "failed",
			60_000,
		);
		const detail = await b.client.runs.get({ runId: started.id });
		expect(detail.status).toBe("finished");
		expect(detail.steps.map((s) => s.device?.thisDevice)).toEqual([
			true,
			false,
			true,
		]);
		expect(String(detail.steps[1]?.outputs.log_tail)).toContain("here.txt");
		expect(String(detail.steps[2]?.outputs.log_tail)).toContain("there.txt");
	}, 90_000);

	test("a node whose Device is offline sleeps, and continues when it is back", async () => {
		await flowIn(a, "later", [
			shell("first", "sleep 2"),
			shell("there", "echo from B", bName),
		]);
		const started = await a.client.runs.start({
			projectId,
			flowName: "later",
		});
		await stopDaemon(b);
		const asleep = await waitFor(
			() => a.client.runs.get({ runId: started.id }),
			(r) => r.status === "sleeping",
			30_000,
		);
		expect(asleep.steps[1]?.nodeId).toBe("there");
		b = await startDaemon(root, "b", b.env, b.port);
		await waitFor(
			() => runOn(a, started.id),
			(r) => r?.status === "finished",
			60_000,
		);
		const detail = await a.client.runs.get({ runId: started.id });
		expect(String(detail.steps[1]?.outputs.log_tail).trim()).toBe("from B");
	}, 120_000);

	test("a run on B while B is offline waits, makes its worktree on B when it is back, and both Replicas show it", async () => {
		await flowIn(a, "offline-start", [shell("where", "pwd")]);
		const bId = (await b.client.devices.list()).thisComputer?.id as string;
		await stopDaemon(b);
		const started = await a.client.runs.start({
			projectId,
			flowName: "offline-start",
			deviceId: bId,
		});
		expect(started.branch).toBe("");
		await waitFor(
			() => a.client.runs.get({ runId: started.id }),
			(r) => r.status === "sleeping",
			30_000,
		);
		b = await startDaemon(root, "b", b.env, b.port);
		const done = await waitFor(
			() => runOn(a, started.id),
			(r) => r?.status === "finished",
			60_000,
		);
		expect(done?.branch).toStartWith("nightshift/");
		const detail = await a.client.runs.get({ runId: started.id });
		expect(String(detail.steps[0]?.outputs.log_tail).trim()).toStartWith(
			realpathSync(root),
		);
		// B has the run from A's log: the branch comes from the event.
		const onB = await waitFor(
			() => runOn(b, started.id),
			(r) => r?.status === "finished",
			60_000,
		);
		expect(onB?.branch).toBe(done?.branch);
	}, 120_000);

	test("Move to: B walks a run A started, from A's archived checkpoint", async () => {
		await flowIn(a, "moving", [
			shell("before", "echo before"),
			{
				id: "ask",
				type: "decision",
				position: { x: 0, y: 0 },
				prompt: "Go on?",
				options: [{ name: "pass" }],
				by: "person",
				decider: "typesafe",
			},
			shell("after", "echo after"),
		]);
		const started = await a.client.runs.start({
			projectId,
			flowName: "moving",
		});
		await waitFor(
			() => runOn(a, started.id),
			(r) => r?.status === "waiting",
			30_000,
		);
		const bId = (await b.client.devices.list()).thisComputer?.id as string;
		await waitFor(
			() => runOn(b, started.id),
			(r) => r?.status === "waiting",
			30_000,
		);
		await a.client.runs.move({ runId: started.id, deviceId: bId });

		// Both Replicas name B as its Walker now.
		await waitFor(
			() => runOn(a, started.id),
			(r) => r?.walker.id === bId,
		);
		await waitFor(
			() => runOn(b, started.id),
			(r) => r?.walker.thisDevice === true,
		);
		// B answers its Gate itself; the last step runs on A, the run's Device.
		const gate = await waitFor(
			async () =>
				(await b.client.gates.list()).find((g) => g.runId === started.id),
			(g) => g !== undefined,
		);
		await b.client.gates.resolve({
			runId: started.id,
			stepId: gate?.stepId as string,
			choice: "pass",
		});
		await waitFor(
			() => runOn(b, started.id),
			(r) => r?.status === "finished",
			60_000,
		);
		const detail = await b.client.runs.get({ runId: started.id });
		expect(detail.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["before", "pass"],
			["ask", "pass"],
			["after", "pass"],
		]);
		expect(detail.steps[2]?.device?.thisDevice).toBe(false);
		expect(String(detail.steps[2]?.outputs.log_tail).trim()).toBe("after");
		await waitFor(
			() => runOn(a, started.id),
			(r) => r?.status === "finished",
			30_000,
		);
	}, 120_000);
});
