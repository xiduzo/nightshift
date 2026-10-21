import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnyTextAdapter, TextOptions } from "@tanstack/ai";
import type { SandboxProvider } from "@tanstack/ai-sandbox";
import type { AgentEvent, AgentSessionInput } from "../port/types";
import {
	type AdapterSetup,
	type HarnessSpec,
	harnessSession,
	sessionReport,
} from "./adapter-session";
import type { SdkSignals } from "./translate";

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "nightshift-session-cwd-"));
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

function input(overrides: Partial<AgentSessionInput> = {}): AgentSessionInput {
	return {
		cwd,
		prompt: "Do the thing",
		model: "fake-model",
		permissionMode: "default",
		signal: new AbortController().signal,
		...overrides,
	};
}

const SESSION_EVENT = "fake.session-id";

/** The harness's own name for the report tool. */
const REPORT_TOOL_ID = "mcp__fake__report_step";

const spec = (overrides: Partial<HarnessSpec> = {}): HarnessSpec => ({
	profile: {
		label: "Fake",
		sessionEvent: SESSION_EVENT,
		createObserver: () => (signals: SdkSignals) => signals,
	},
	report: "by-mode",
	...overrides,
});

/** The AG-UI chunks of one finished turn that reports its session id. */
function finishedTurn(threadId: string | undefined): unknown[] {
	return [
		{ type: "RUN_STARTED", threadId, runId: "r-1" },
		{ type: "CUSTOM", name: SESSION_EVENT, value: { sessionId: "s-1" } },
		{ type: "TEXT_MESSAGE_START", messageId: "m-1", role: "assistant" },
		{ type: "TEXT_MESSAGE_CONTENT", messageId: "m-1", delta: "hi" },
		{ type: "TEXT_MESSAGE_END", messageId: "m-1" },
		{ type: "RUN_FINISHED", threadId, runId: "r-1" },
	];
}

type Seen = { options: TextOptions };

/**
 * A TanStack text adapter that records what `chat()` sends it and yields
 * `chunks`. With `hang`, it yields the session id and then waits for the
 * abort instead of finishing.
 */
function fakeAdapter(seen: Seen[], hang = false): AnyTextAdapter {
	return {
		kind: "text",
		name: "fake",
		model: "fake-model",
		"~types": {} as never,
		chatStream: async function* (options: TextOptions) {
			seen.push({ options });
			const chunks = finishedTurn(options.threadId);
			if (!hang) {
				for (const chunk of chunks) yield chunk as never;
				return;
			}
			for (const chunk of chunks.slice(0, 2)) yield chunk as never;
			// `chat()` hands the adapter its abort as `request.signal`.
			const signal = abortSignalOf(options);
			for (let i = 0; i < 100 && !signal?.aborted; i++) {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		},
		structuredOutput: async () => {
			throw new Error("not used");
		},
	} as unknown as AnyTextAdapter;
}

const abortSignalOf = (options: TextOptions) =>
	(options.request as RequestInit | undefined)?.signal;

async function collect(stream: AsyncIterable<AgentEvent>) {
	const events: AgentEvent[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

describe("sessionReport", () => {
	test("by-mode: the tool, except in plan mode", () => {
		const byMode = spec({
			profile: {
				label: "Fake",
				sessionEvent: SESSION_EVENT,
				createObserver: () => (signals: SdkSignals) => signals,
				reportToolId: REPORT_TOOL_ID,
			},
		});
		const tool = sessionReport(input({ stepReport: true }), byMode, ["Read"]);
		expect(tool.tools.map((t) => t.name)).toEqual(["report_step"]);
		expect(tool.allowedTools).toEqual(["Read", REPORT_TOOL_ID]);
		const plan = sessionReport(
			input({ stepReport: true, permissionMode: "plan" }),
			byMode,
			["Read"],
		);
		expect(plan.tools).toEqual([]);
		expect(plan.allowedTools).toEqual(["Read"]);
		expect(plan.prompt).toContain("NIGHTSHIFT-REPORT");
	});

	test("tool: plan mode reports with the tool too", () => {
		const report = sessionReport(
			input({ stepReport: true, permissionMode: "plan" }),
			spec({ report: "tool" }),
		);
		expect(report.tools.map((t) => t.name)).toEqual(["report_step"]);
	});

	test("text: never the tool", () => {
		const report = sessionReport(
			input({ stepReport: true }),
			spec({ report: "text" }),
		);
		expect(report.tools).toEqual([]);
		expect(report.prompt).toContain("NIGHTSHIFT-REPORT");
	});

	test("no step report: the prompt as it is, no tool", () => {
		const report = sessionReport(input(), spec({ report: "tool" }), ["Read"]);
		expect(report).toEqual({
			prompt: "Do the thing",
			tools: [],
			allowedTools: ["Read"],
		});
	});
});

describe("sessionReport: artifacts", () => {
	const ARTIFACT_TOOL_ID = "mcp__fake__save_artifact";
	const byMode = spec({
		profile: {
			label: "Fake",
			sessionEvent: SESSION_EVENT,
			createObserver: () => (signals: SdkSignals) => signals,
			reportToolId: REPORT_TOOL_ID,
			artifactToolId: ARTIFACT_TOOL_ID,
		},
	});
	const saveArtifact = async () => "kept";

	test("a session that keeps artifacts gets the tool, its instruction and its allow rule", () => {
		const report = sessionReport(
			input({ stepReport: true, saveArtifact }),
			byMode,
			["Read"],
		);
		expect(report.tools.map((t) => t.name)).toEqual([
			"report_step",
			"save_artifact",
		]);
		expect(report.allowedTools).toEqual([
			"Read",
			REPORT_TOOL_ID,
			ARTIFACT_TOOL_ID,
		]);
		expect(report.prompt).toContain("`save_artifact`");
	});

	test("without a step report, the tool still comes", () => {
		const report = sessionReport(input({ saveArtifact }), byMode);
		expect(report.tools.map((t) => t.name)).toEqual(["save_artifact"]);
		expect(report.allowedTools).toEqual([ARTIFACT_TOOL_ID]);
	});

	test("plan mode and a text harness run no tools: no artifact tool", () => {
		const plan = sessionReport(
			input({ saveArtifact, permissionMode: "plan" }),
			byMode,
		);
		expect(plan.tools).toEqual([]);
		expect(plan.prompt).toBe("Do the thing");
		const text = sessionReport(
			input({ saveArtifact }),
			spec({ report: "text" }),
		);
		expect(text.tools).toEqual([]);
	});

	test("the tool hands the path and title to saveArtifact", async () => {
		const kept: unknown[] = [];
		const report = sessionReport(
			input({
				saveArtifact: async (file) => {
					kept.push(file);
					return "Kept.";
				},
			}),
			spec({ report: "tool" }),
		);
		const tool = report.tools[0] as unknown as {
			execute: (args: unknown) => Promise<unknown>;
		};
		expect(await tool.execute({ path: "shot.png", title: " Login " })).toBe(
			"Kept.",
		);
		expect(kept).toEqual([{ path: "shot.png", title: "Login" }]);
		await expect(tool.execute({ path: "" })).rejects.toThrow("path");
	});
});

describe("harnessSession", () => {
	test("one sandbox in cwd, the session id, the text, the cleanup", async () => {
		const seen: Seen[] = [];
		const created: unknown[] = [];
		let cleanups = 0;
		const events = await collect(
			harnessSession({
				input: input(),
				spec: spec(),
				adapter: (): AdapterSetup => ({
					adapter: fakeAdapter(seen),
					wrapProvider: (provider: SandboxProvider): SandboxProvider => ({
						name: provider.name,
						capabilities: () => provider.capabilities(),
						create: async (create) => {
							created.push(create);
							return provider.create(create);
						},
						resume: (resume) => provider.resume(resume),
						destroy: (destroy) => provider.destroy(destroy),
					}),
					cleanup: async () => {
						cleanups += 1;
					},
				}),
			}),
		);
		expect(events).toEqual([
			{ type: "session", sessionId: "s-1" },
			{ type: "text", messageId: "m-1", delta: "hi" },
			{ type: "finished" },
		]);
		// The sandbox: built once, on the local-process provider, in `cwd`.
		expect(seen).toHaveLength(1);
		expect(created).toHaveLength(1);
		expect(seen[0]?.options.threadId).toStartWith("nightshift-");
		expect(seen[0]?.options.messages).toEqual([
			{ role: "user", content: "Do the thing" },
		]);
		// Destroyed on complete, but `cwd` stays, with no projection marker.
		expect(await readdir(cwd)).toEqual([]);
		expect(cleanups).toBe(1);
	});

	test("step-report tool attached, plan-mode quirk per the spec", async () => {
		const toolSpec = spec({ report: "tool" });
		for (const [report, mode, names] of [
			[toolSpec, "plan", ["report_step"]],
			[spec(), "plan", []],
			[spec(), "default", ["report_step"]],
			[spec({ report: "text" }), "default", []],
		] as const) {
			const seen: Seen[] = [];
			await collect(
				harnessSession({
					input: input({ stepReport: true, permissionMode: mode }),
					spec: report,
					adapter: () => ({ adapter: fakeAdapter(seen) }),
				}),
			);
			expect(seen[0]?.options.tools?.map((t) => t.name) ?? []).toEqual([
				...names,
			]);
		}
	});

	test("resume: the session id goes to the adapter, and up front when the spec says so", async () => {
		const seen: Seen[] = [];
		const run = (s: HarnessSpec) =>
			collect(
				harnessSession({
					input: input({ resumeSessionId: "old-1" }),
					spec: s,
					adapter: () => ({ adapter: fakeAdapter(seen) }),
				}),
			);
		const announced = await run(spec());
		expect(announced[0]).toEqual({ type: "session", sessionId: "s-1" });
		const silent = await run(spec({ resumeIsSilent: true }));
		expect(silent[0]).toEqual({ type: "session", sessionId: "old-1" });
		for (const { options } of seen) {
			expect(options.modelOptions).toEqual({ sessionId: "old-1" });
		}
	});

	test("effort: `reasoning` only when the spec takes it for the model", async () => {
		const seen: Seen[] = [];
		const run = (s: HarnessSpec) =>
			collect(
				harnessSession({
					input: input({ effort: "high" }),
					spec: s,
					adapter: () => ({ adapter: fakeAdapter(seen) }),
				}),
			);
		await run(spec());
		await run(spec({ reasoningFor: (model) => model === "fake-model" }));
		expect(seen.map(({ options }) => options.reasoning?.level)).toEqual([
			undefined,
			"high",
		]);
	});

	test("an abort reaches the adapter and ends the stream with one aborted error", async () => {
		const controller = new AbortController();
		const seen: Seen[] = [];
		const events: AgentEvent[] = [];
		for await (const event of harnessSession({
			input: input({ signal: controller.signal }),
			spec: spec(),
			adapter: () => ({ adapter: fakeAdapter(seen, true) }),
			abortGraceMs: 200,
		})) {
			events.push(event);
			if (event.type === "session") controller.abort();
		}
		expect(events).toEqual([
			{ type: "session", sessionId: "s-1" },
			{ type: "error", kind: "aborted", message: "The session was aborted" },
		]);
		const signal = seen[0] && abortSignalOf(seen[0].options);
		expect(signal?.aborted).toBe(true);
	});

	test("a failing adapter factory ends the stream with an error, never a throw", async () => {
		const events = await collect(
			harnessSession({
				input: input(),
				spec: spec(),
				adapter: () => {
					throw new Error("no executable");
				},
			}),
		);
		expect(events.at(-1)).toMatchObject({
			type: "error",
			kind: "harness",
			message: expect.stringContaining("no executable"),
		});
	});

	test("MCP servers as skills take URL servers only", async () => {
		const events = await collect(
			harnessSession({
				input: input({
					mcpServers: { fs: { command: "npx", args: ["fs"], env: {} } },
				}),
				spec: spec({ mcpAsSkills: true }),
				adapter: () => ({ adapter: fakeAdapter([]) }),
			}),
		);
		expect(events.at(-1)).toMatchObject({
			type: "error",
			message: expect.stringContaining("Remove fs from the node"),
		});
	});
});
