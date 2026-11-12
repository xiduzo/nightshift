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

	/** A run whose step `s2` printed a thousand lines: what is saved, then live. */
	const watching = (stepEnded: boolean) =>
		({
			runs: {
				watch: async (_input: unknown, { signal }: { signal: AbortSignal }) =>
					(async function* () {
						const entry = (seq: number, stepId: string, event: object) => ({
							kind: "transcript",
							entry: { seq, stepId, sessionId: null, at: seq, event },
						});
						yield { kind: "status", status: "failed" };
						yield {
							kind: "step",
							step: { id: "s2", endedAt: stepEnded ? 9 : null },
						};
						yield entry(1, "s1", { type: "text", messageId: "m", delta: "A" });
						for (let i = 0; i < 1000; i++) {
							yield entry(2 + i, "s2", {
								type: "command-output",
								stream: "stdout",
								text: `line ${i}\n`,
							});
						}
						// Live: nothing more comes until the reader lets go.
						await new Promise((resolve) =>
							signal.addEventListener("abort", resolve, { once: true }),
						);
					})(),
			},
		}) as unknown as AppRouterClient;

	test("get_run reads a step's transcript over the watch until the replay is done", async () => {
		const signal = new AbortController().signal;
		const started = now();
		const read = await apiTranscripts(watching(true), {
			idleMs: 50,
		}).stepTranscript("r1", "s2", signal);
		expect(now() - started).toBeLessThan(2_000);
		expect(read.holds).toBe("whole");
		expect(read.entries).toHaveLength(1000);
		expect(read.entries.every((entry) => entry.stepId === "s2")).toBe(true);
		// A step that still runs: what it saved so far.
		const running = await apiTranscripts(watching(false), {
			idleMs: 50,
		}).stepTranscript("r1", "s2", signal);
		expect(running.holds).toBe("so-far");
		// Out of time: what came, cut.
		const late = await apiTranscripts(watching(true), {
			idleMs: 5_000,
			totalMs: 50,
		}).stepTranscript("r1", "s2", signal);
		expect(late.holds).toBe("cut");
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
