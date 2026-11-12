import { describe, expect, test } from "bun:test";
import type { AppRouterClient } from "@nightshift/api";
import { now } from "@nightshift/time";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { apiPort, apiTranscripts, mcpOptions } from "./mcp";

describe("nightshift mcp", () => {
	test("the daemon and the links default to this computer", () => {
		expect(mcpOptions([], { PORT: "4100" }, "/work/app")).toEqual({
			daemon: "http://localhost:4100",
			ui: "http://localhost:4100",
			project: null,
			folder: "/work/app",
		});
	});

	test("flags win over the environment; an id stays an id", () => {
		expect(
			mcpOptions(
				[
					"--daemon",
					"http://127.0.0.1:4200/",
					"--ui",
					"http://localhost:3001",
					"--project",
					"p1",
				],
				{ NIGHTSHIFT_DAEMON_URL: "http://localhost:9" },
				"/work/app",
			),
		).toEqual({
			daemon: "http://127.0.0.1:4200",
			ui: "http://localhost:3001",
			project: "p1",
			folder: "/work/app",
		});
		expect(mcpOptions(["--project", "."], {}, process.cwd())?.project).toBe(
			process.cwd(),
		);
		expect(mcpOptions(["--nope"], {}, "/")).toBeNull();
	});

	test("list_runs marks a test run with its pinned and skipped nodes", async () => {
		const row = (id: string, more: object = {}) => ({
			id,
			flowName: "watch",
			title: `watch · ${id}`,
			status: "finished",
			reason: null,
			createdAt: 1,
			endedAt: 2,
			costUsd: 0.5,
			costEstimated: false,
			costMissing: 0,
			costCalls: 1,
			...more,
		});
		const test = { pinned: ["fetch"], skipped: ["check"] };
		const client = {
			runs: { list: async () => [row("try", { test }), row("real")] },
		} as unknown as AppRouterClient;
		const runs = await apiPort(client, { ui: "http://localhost:9" }).runs(
			"p1",
			{ limit: 10 },
		);
		expect(runs.map((run) => [run.id, run.test])).toEqual([
			["try", test],
			["real", undefined],
		]);
		expect(runs[1]).not.toHaveProperty("test");
	});

	/**
	 * Night Shift on a port that answers each call with `answer`: its
	 * client, and how to stop it.
	 */
	const answering = (answer: () => Response) => {
		const server = Bun.serve({ port: 0, fetch: answer });
		const client: AppRouterClient = createORPCClient(
			new RPCLink({ url: `http://localhost:${server.port}/rpc` }),
		);
		return { client, stop: () => server.stop(true) };
	};
	/** An older Night Shift: a route it does not have is its server's plain 404. */
	const older = () =>
		new Response("404 Not Found", {
			status: 404,
			headers: { "content-type": "text/plain; charset=UTF-8" },
		});

	/** One entry of step `stepId`'s transcript. */
	const entryOf = (seq: number, stepId: string, event: object) => ({
		seq,
		stepId,
		sessionId: null,
		at: seq,
		event,
	});
	const line = (i: number) => ({
		type: "command-output",
		stream: "stdout",
		text: `line ${i}\n`,
	});

	/**
	 * A run whose step `s2` printed a thousand lines, as `runs.watch` sends
	 * it: what is saved, then live. `stepTranscript` is the whole read.
	 */
	const watching = (stepEnded: boolean, stepTranscript: unknown) =>
		({
			runs: {
				stepTranscript,
				watch: async (_input: unknown, { signal }: { signal: AbortSignal }) =>
					(async function* () {
						const entry = (seq: number, stepId: string, event: object) => ({
							kind: "transcript",
							entry: entryOf(seq, stepId, event),
						});
						yield { kind: "status", status: "failed" };
						yield {
							kind: "step",
							step: { id: "s2", endedAt: stepEnded ? 9 : null },
						};
						yield entry(1, "s1", { type: "text", messageId: "m", delta: "A" });
						for (let i = 0; i < 1000; i++) yield entry(2 + i, "s2", line(i));
						// Live: nothing more comes until the reader lets go.
						await new Promise((resolve) =>
							signal.addEventListener("abort", resolve, { once: true }),
						);
					})(),
			},
		}) as unknown as AppRouterClient;

	test("get_run reads the failed step's transcript whole, in one call", async () => {
		const failed = {
			id: "r1",
			projectId: "p1",
			flowName: "news",
			status: "failed",
			reason: null,
			inputs: {},
			flow: { nodes: [] },
			calledFlows: {},
			steps: [
				{
					id: "s1",
					nodeId: "fetch",
					outcome: "done",
					error: null,
					outputs: {},
				},
				{
					id: "s2",
					nodeId: "build",
					outcome: "fail",
					error: null,
					outputs: {},
				},
			],
			report: null,
			warnings: [],
			costUsd: 0,
			costEstimated: false,
			costMissing: 0,
			costCalls: 0,
		};
		const asked: unknown[] = [];
		const client = {
			runs: {
				get: async () => failed,
				stepTranscript: async (input: unknown) => {
					asked.push(input);
					return {
						entries: [0, 1, 2].map((i) => entryOf(2 + i, "s2", line(i))),
						holds: "whole",
					};
				},
				watch: async () => {
					throw new Error("A whole read needs no watch.");
				},
			},
		} as unknown as AppRouterClient;
		const found = await apiPort(client, { ui: "http://localhost:9" }).run(
			"p1",
			"r1",
		);
		expect(asked).toEqual([{ runId: "r1", stepId: "s2" }]);
		expect(found?.run.failedStepId).toBe("s2");
		expect(found?.run.transcript).toEqual(["line 0", "line 1", "line 2"]);
		expect(found?.run).not.toHaveProperty("transcriptHolds");
	});

	test("an older Night Shift without the whole read: get_run reads the step over the watch until the replay is done", async () => {
		const night = answering(older);
		const { stepTranscript } = night.client.runs;
		try {
			const signal = new AbortController().signal;
			const started = now();
			const read = await apiTranscripts(watching(true, stepTranscript), {
				idleMs: 50,
			}).stepTranscript("r1", "s2", signal);
			expect(now() - started).toBeLessThan(2_000);
			expect(read.holds).toBe("whole");
			expect(read.entries).toHaveLength(1000);
			expect(read.entries.every((entry) => entry.stepId === "s2")).toBe(true);
			// A step that still runs: what it saved so far.
			const running = await apiTranscripts(watching(false, stepTranscript), {
				idleMs: 50,
			}).stepTranscript("r1", "s2", signal);
			expect(running.holds).toBe("so-far");
			// Out of time: what came, cut.
			const late = await apiTranscripts(watching(true, stepTranscript), {
				idleMs: 5_000,
				totalMs: 50,
			}).stepTranscript("r1", "s2", signal);
			expect(late.holds).toBe("cut");
		} finally {
			night.stop();
		}
	});

	test("a run or a step that Night Shift cannot find is not a missing route: no watch", async () => {
		const words = "This run is not in one of your Spaces.";
		// The route's own refusal, as Night Shift sends it.
		const night = answering(() =>
			Response.json(
				{
					json: {
						defined: true,
						code: "NOT_FOUND",
						status: 404,
						message: words,
					},
				},
				{ status: 404 },
			),
		);
		try {
			const client = watching(true, night.client.runs.stepTranscript);
			let watched = false;
			client.runs.watch = (async () => {
				watched = true;
				throw new Error("No watch.");
			}) as unknown as AppRouterClient["runs"]["watch"];
			await expect(
				apiTranscripts(client).stepTranscript(
					"r1",
					"s2",
					new AbortController().signal,
				),
			).rejects.toThrow(words);
			expect(watched).toBe(false);
		} finally {
			night.stop();
		}
	});

	test("get_run reads a run of the project, with its report", async () => {
		const detail = {
			id: "r1",
			projectId: "p1",
			flowName: "news",
			status: "finished",
			reason: null,
			inputs: {},
			flow: { nodes: [] },
			calledFlows: {},
			steps: [
				{
					id: "s9",
					nodeId: "done",
					outcome: "done",
					error: null,
					outputs: { report: "## New" },
				},
			],
			report: { stepId: "s9", excerpt: "## New", more: false },
			warnings: [],
			costUsd: 0,
			costEstimated: false,
			costMissing: 0,
			costCalls: 0,
		};
		const client = {
			runs: {
				get: async ({ runId }: { runId: string }) => {
					if (runId !== "r1") throw new Error("Not found.");
					return detail;
				},
			},
		} as unknown as AppRouterClient;
		const port = apiPort(client, { ui: "http://localhost:9" });
		const found = await port.run("p1", "r1");
		expect(found?.run.failedStepId).toBeNull();
		expect(found?.report).toEqual({
			stepId: "s9",
			text: "## New",
			partial: false,
			cut: false,
		});
		expect(await port.run("p2", "r1")).toBeNull();
		expect(await port.run("p1", "nope")).toBeNull();
	});

	test("a project without a folder says so, and an older Host's projects have one", async () => {
		const project = (id: string, folder?: boolean) => ({
			id,
			name: id,
			repoPath: null,
			remote: null,
			...(folder === undefined ? {} : { folder }),
			createdAt: 1,
			clones: [],
		});
		const client = {
			projects: {
				// An older Host sends no `folder`: that project has one.
				list: async () => [
					project("notes", false),
					project("app", true),
					project("old"),
				],
			},
		} as unknown as AppRouterClient;
		const projects = await apiPort(client, {
			ui: "http://localhost:9",
		}).projects();
		expect(projects).toEqual([
			{ id: "notes", name: "notes", path: null, folder: false },
			{ id: "app", name: "app", path: null },
			{ id: "old", name: "old", path: null },
		]);
	});

	test("a flow is checked in the place the editor reads: the folder, the Devices with their profiles' modes", async () => {
		const client = {
			flows: { map: async () => ({ fix: null }) },
			runs: {
				devices: async () => [
					{
						deviceId: "mac",
						name: "MacBook",
						profiles: [
							{
								id: "night",
								name: "night",
								kind: "agent",
								permissionMode: "acceptEdits",
							},
						],
					},
					// Its profiles this computer cannot tell.
					{ deviceId: "studio", name: "Studio" },
				],
			},
			cliTools: {
				list: async () => [
					{ name: "acli-work", program: "acli", login: { kind: "x" } },
				],
			},
			connections: {
				list: async () => ({ connections: [{ name: "github" }] }),
			},
			projects: {
				list: async () => [
					{ id: "notes", folder: false },
					// An older Host sends no `folder`: that project has one.
					{ id: "app" },
				],
			},
		} as unknown as AppRouterClient;
		const port = apiPort(client, { ui: "http://localhost:9" });
		expect(await port.place("notes", "fix")).toEqual<unknown>({
			flows: { fix: null },
			name: "fix",
			devices: [
				{
					deviceId: "mac",
					name: "MacBook",
					profiles: [
						{
							id: "night",
							name: "night",
							kind: "agent",
							permissionMode: "acceptEdits",
						},
					],
				},
				{ deviceId: "studio", name: "Studio" },
			],
			connections: ["github"],
			cliTools: [{ name: "acli-work", program: "acli", signsIn: true }],
			folder: false,
		});
		expect((await port.place("app")).folder).toBe(true);
	});

	test("without Night Shift on this computer each tool says so", async () => {
		// A port nothing listens on.
		const server = Bun.serve({ port: 0, fetch: () => new Response() });
		const url = `http://localhost:${server.port}`;
		server.stop(true);
		const client: AppRouterClient = createORPCClient(
			new RPCLink({ url: `${url}/rpc` }),
		);
		const port = apiPort(client, { ui: url });
		await expect(port.projects()).rejects.toThrow(
			"Night Shift is not running on this computer. Start it, then try again.",
		);
		expect(port.runLink("r1")).toBe(`${url}/runs/r1`);
		// A Gate opens at its step.
		expect(port.runLink("r1", "s 1")).toBe(`${url}/runs/r1?step=s%201`);
		await expect(port.gates()).rejects.toThrow(
			"Night Shift is not running on this computer. Start it, then try again.",
		);
	});
});
