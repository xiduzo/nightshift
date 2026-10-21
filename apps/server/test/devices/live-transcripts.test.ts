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
 * Each watches a running step of a run the other walks, and sees its
 * output as it is written, before the step ends.
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
		version: 5,
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

/**
 * Watches a run on `viewer` in the background: the command output it gets,
 * and whether the step had ended there when each line came.
 */
function watch(viewer: Daemon, runId: string, afterSeq?: number) {
	const controller = new AbortController();
	const lines: string[] = [];
	const seqs: number[] = [];
	const done = (async () => {
		const stream = await viewer.client.runs.watch(
			{ runId, ...(afterSeq === undefined ? {} : { afterSeq }) },
			{ signal: controller.signal },
		);
		for await (const item of stream) {
			if (item.kind !== "transcript") continue;
			seqs.push(item.entry.seq);
			if (item.entry.event.type === "command-output") {
				lines.push(item.entry.event.text.trim());
			}
		}
	})().catch(() => {});
	return { lines, seqs, stop: () => controller.abort(), done };
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
	test("the Host shows a running step that a Device walks, as it is written", async () => {
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

		const watching = watch(a, started.id);
		await waitFor(
			() => watching.lines,
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
		expect(watching.lines).toEqual(["first line", "second line"]);
		watching.stop();
		await watching.done;
	}, 60_000);

	test("a Device shows a running step that its Host walks, and resumes from its cursor", async () => {
		const marker = join(root, "go-a");
		const started = await a.client.runs.start({
			projectId,
			flow: slowFlow(marker),
		});
		await waitFor(
			() => stepOf(b, started.id).catch(() => undefined),
			(step) => step !== undefined && step.endedAt === null,
		);

		const first = watch(b, started.id);
		await waitFor(
			() => first.lines,
			(lines) => lines.includes("first line"),
		);
		expect((await stepOf(a, started.id))?.endedAt).toBeNull();
		first.stop();
		await first.done;

		// Back from its last entry: what follows, nothing twice.
		const again = watch(b, started.id, first.seqs.at(-1));
		await Bun.write(marker, "");
		await waitFor(
			() => again.lines,
			(lines) => lines.includes("second line"),
		);
		expect(again.lines).toEqual(["second line"]);
		const seen = [...first.seqs, ...again.seqs];
		expect(new Set(seen).size).toBe(seen.length);
		again.stop();
		await again.done;
	}, 60_000);
});
