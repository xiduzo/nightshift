import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppRouterClient } from "@nightshift/api";
import type { RunSummary } from "@nightshift/engine";
import type { InferClientInputs } from "@orpc/client";

import {
	type Daemon,
	pair,
	startDaemon,
	stopDaemon,
	waitFor,
} from "../test-daemons";

/**
 * The event log exchange between two daemons: A is the Host, B pairs with
 * it. B starts a run in A's Space, and A walks it (ADR 1): its steps run
 * on B. B's Replica gets the run as it goes, answers its Gate (A applies
 * the answer), and opens the transcript from the archive. This is the
 * transport's smoke test: the exchange itself (by cursor, Commands,
 * refusals, a Host that was away) is tested in memory in packages/devices
 * (`device-exchange.test.ts`). `host-walks.test.ts` has B walk a run while
 * A is away, and send it to A later.
 */

const root = mkdtempSync(join(tmpdir(), "nightshift-exchange-"));
const REMOTE = "https://example.com/acme/app.git";

/** A flow as `runs.start` takes it inline. */
type Flow = Extract<
	InferClientInputs<AppRouterClient>["runs"]["start"],
	{ flow: unknown }
>["flow"];

let a: Daemon;
let b: Daemon;
let aId: string;
let bId: string;
/** A's Person's personal Space: the Space B takes part in. */
let spaceId: string;
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

/** A command, then a Gate: B's run waits for an answer. */
const gateFlow: Flow = {
	version: 7,
	inputs: [],
	outputs: [],
	start: "hello",
	nodes: [
		{
			id: "hello",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo hello from B",
			output: "text",
		},
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
	edges: [{ id: "e1", from: "hello", outcome: "pass", to: "ship" }],
} as Flow;

async function runOn(daemon: Daemon, runId: string) {
	return (await daemon.client.runs.list()).find((r) => r.id === runId);
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
}, 90_000);

afterAll(async () => {
	await Promise.all([stopDaemon(a), stopDaemon(b)]);
	rmSync(root, { recursive: true, force: true });
});

describe("the event log exchange", () => {
	test("B starts a run in A's Space; A walks it, B sees it live, answers its Gate, and opens its transcript", async () => {
		// A's project, in A's personal Space.
		const added = await a.client.projects.add({ repoPath: await repo("on-a") });
		projectId = added.id;
		spaceId = (await a.client.spaces.list()).active as string;

		// The Space reaches B: B's Person works in it as A's Person does on A.
		// B joined A as its home Host, so B's own Personal merged into it
		// (ADR 1): B has one personal Space, named "Personal", which A keeps.
		const listed = await waitFor(
			async () => (await b.client.spaces.list()).spaces,
			(spaces) => spaces.some((s) => s.id === spaceId),
		);
		expect(listed.find((s) => s.id === spaceId)).toMatchObject({
			name: "Personal",
			personal: true,
			role: "owner",
		});
		expect(listed.filter((s) => s.personal)).toHaveLength(1);
		await b.client.spaces.switch({ spaceId });

		// The project is listed on B before B has a folder of it.
		const listedOnB = await waitFor(
			() => b.client.projects.list(),
			(projects) => projects.some((p) => p.id === projectId),
		);
		expect(listedOnB.find((p) => p.id === projectId)?.repoPath).toBeNull();
		// Its flows come from A's Clone, through A.
		expect(await b.client.flows.list({ projectId })).toEqual([]);

		// B's folder of the same remote is a Clone of A's project, known on A.
		const folder = await repo("on-b");
		const clone = await waitFor(
			() => b.client.projects.add({ repoPath: folder }).catch(() => null),
			(project) => project !== null,
		);
		expect(clone?.id).toBe(projectId);
		const onA = await waitFor(
			async () =>
				(await a.client.projects.list()).find((p) => p.id === projectId),
			(project) => (project?.clones.length ?? 0) === 2,
		);
		expect(onA?.clones.map((c) => [c.deviceId, c.thisDevice])).toEqual([
			[aId, true],
			[bId, false],
		]);

		// B starts a run; A walks it, and it waits at its Gate.
		const started = await b.client.runs.start({ projectId, flow: gateFlow });
		expect(started.walker).toMatchObject({ id: aId, thisDevice: false });
		expect(started.device).toMatchObject({ id: bId, thisDevice: true });
		await waitFor(
			() => runOn(a, started.id),
			(r) => r?.status === "waiting",
		);

		// B's Replica has it, with the same status, walked by A.
		const seen = (await waitFor(
			() => runOn(b, started.id),
			(r) => r?.status === "waiting",
		)) as RunSummary;
		expect(seen.walker).toMatchObject({ id: aId, thisDevice: false });
		// Started by the Person A knows, with B's paths: B is A's owner's own Device.
		const personOfA = (await a.client.settings.get()).daemon.device.ownerId;
		expect(seen.startedBy?.id).toBe(personOfA);
		expect((await runOn(a, started.id))?.startedBy?.name).toBeTruthy();
		expect(seen.worktreePath).not.toBe("");
		expect(seen.walker.name).toBeTruthy();
		const gate = await waitFor(
			async () =>
				(await b.client.gates.list()).find((g) => g.runId === started.id),
			(g) => g !== undefined,
		);
		expect(gate?.walker.id).toBe(aId);
		expect(gate?.answerPending).toBe(false);

		// B's Person answers it on B; A applies it and the run finishes on both.
		await b.client.gates.resolve({
			runId: started.id,
			stepId: gate?.stepId as string,
			choice: "approve",
			note: "Ship it from B.",
		});
		await waitFor(
			() => runOn(a, started.id),
			(r) => r?.status === "finished",
		);
		const finished = await waitFor(
			() => runOn(b, started.id),
			(r) => r?.status === "finished",
		);
		expect(finished?.reason).toBe((await runOn(a, started.id))?.reason);
		const detail = await waitFor(
			() => b.client.runs.get({ runId: started.id }),
			(d) => d.commands.length === 0,
		);
		expect(
			detail.steps.map((s) => [s.nodeId, s.outcome, s.device?.id]),
		).toEqual([
			["hello", "pass", bId],
			["ship", "approve", bId],
		]);
		expect(detail.steps[1]?.outputs.note).toBe("Ship it from B.");

		// B opens the command step's transcript: it comes from the archive.
		const controller = new AbortController();
		const stream = await b.client.runs.watch(
			{ runId: started.id },
			{ signal: controller.signal },
		);
		let output = "";
		for await (const item of stream) {
			if (item.kind === "transcript") output += JSON.stringify(item.entry);
			if (output.includes("hello from B")) break;
		}
		controller.abort();
		expect(output).toContain("hello from B");
	}, 90_000);
});
