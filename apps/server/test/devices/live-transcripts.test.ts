import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppRouterClient } from "@nightshift/api";
import type { InferClientInputs } from "@orpc/client";

import {
	type Daemon,
	pair,
	startDaemon,
	stopDaemon,
	waitFor,
} from "../test-daemons";

/**
 * Live transcripts between two daemons: A is the Host, B pairs with it.
 * B starts a run, A walks it, and its step runs on B (ADR 1). A, the
 * Walker, and B, through A, watch the running step and see its output as
 * it is written, before the step ends. The transport's smoke test: both
 * ways and the resume from a cursor are tested in memory in
 * packages/devices (`device-exchange.test.ts`).
 */

const root = mkdtempSync(join(tmpdir(), "nightshift-live-"));
const REMOTE = "https://example.com/acme/live.git";

type Flow = Extract<
	InferClientInputs<AppRouterClient>["runs"]["start"],
	{ flow: unknown }
>["flow"];

let a: Daemon;
let b: Daemon;
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

/** One command step that prints, waits for `marker`, and prints again. */
function slowFlow(marker: string): Flow {
	return {
		version: 7,
		inputs: [],
		outputs: [],
		start: "build",
		nodes: [
			{
				id: "build",
				type: "command",
				position: { x: 0, y: 0 },
				command: `echo first line; while [ ! -f '${marker}' ]; do sleep 0.1; done; echo second line`,
				output: "text",
			},
		],
		edges: [],
	} as Flow;
}

/** Watches a run on `viewer` in the background: the command output it gets. */
function watch(viewer: Daemon, runId: string) {
	const controller = new AbortController();
	const lines: string[] = [];
	const done = (async () => {
		const stream = await viewer.client.runs.watch(
			{ runId },
			{ signal: controller.signal },
		);
		for await (const item of stream) {
			if (item.kind !== "transcript") continue;
			if (item.entry.event.type === "command-output") {
				lines.push(item.entry.event.text.trim());
			}
		}
	})().catch(() => {});
	return { lines, stop: () => controller.abort(), done };
}

async function stepOf(daemon: Daemon, runId: string) {
	return (await daemon.client.runs.get({ runId })).steps[0];
}

beforeAll(async () => {
	[a, b] = await Promise.all([
		startDaemon(root, "a", { NIGHTSHIFT_HOST: "on" }),
		startDaemon(root, "b", {}),
	]);
	await pair(a, b);
	await waitFor(
		async () => (await b.client.devices.list()).thisComputer?.hosts ?? [],
		(hosts) => hosts[0]?.status === "online",
	);
	projectId = (await a.client.projects.add({ repoPath: await repo("on-a") }))
		.id;
	spaceId = (await a.client.spaces.list()).active as string;
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
}, 90_000);

afterAll(async () => {
	await Promise.all([stopDaemon(a), stopDaemon(b)]);
	rmSync(root, { recursive: true, force: true });
});

describe("live transcripts across Devices", () => {
	test("the Host and the Device show a running step the Host walks, as it is written", async () => {
		const marker = join(root, "go-b");
		const started = await b.client.runs.start({
			projectId,
			flow: slowFlow(marker),
		});
		// A has the run, with its step running.
		await waitFor(
			() => stepOf(a, started.id).catch(() => undefined),
			(step) => step !== undefined && step.endedAt === null,
		);

		expect(started.walker.thisDevice).toBe(false);
		const watching = watch(a, started.id);
		const onB = watch(b, started.id);
		await waitFor(
			() => watching.lines,
			(lines) => lines.includes("first line"),
		);
		await waitFor(
			() => onB.lines,
			(lines) => lines.includes("first line"),
		);
		// The step still runs: the line came live, not from the archive.
		expect((await stepOf(b, started.id))?.endedAt).toBeNull();
		expect((await stepOf(a, started.id))?.endedAt).toBeNull();

		await Bun.write(marker, "");
		await waitFor(
			() => watching.lines,
			(lines) => lines.includes("second line"),
		);
		await waitFor(
			() => onB.lines,
			(lines) => lines.includes("second line"),
		);
		expect(watching.lines).toEqual(["first line", "second line"]);
		expect(onB.lines).toEqual(["first line", "second line"]);
		watching.stop();
		onB.stop();
		await Promise.all([watching.done, onB.done]);
	}, 60_000);
});
