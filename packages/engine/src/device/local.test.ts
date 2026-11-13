import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	defaultDeciderModel,
	fakeDecider,
	fakeHarness,
	fixturePath,
} from "@nightshift/agents/testing";
import type { Decider, McpServerConfig } from "@nightshift/agents/types";
import { FLOW_VERSION } from "@nightshift/flows";
import { createArtifactStore } from "../artifacts/store";
import {
	type CliToolStore,
	createCliToolStore,
} from "../device-config/cli-tools";
import {
	type ConnectionInput,
	type ConnectionStore,
	createConnectionStore,
	type PersonalSecrets,
	type ProjectSecrets,
	type SecretBackend,
} from "../device-config/connections";
import { createRunFolders } from "../run-folders/run-folders";
import { testKnowledge } from "../testing/knowledge";
import {
	connectionsOf,
	createSandbox,
	harnessesOf,
	mustGit,
	type Sandbox,
	type TestDeviceDeps,
} from "../testing/test-support";
import { localDevice } from "./local";
import type { Device, ExecEvent, SessionEvent, SessionInput } from "./types";

/**
 * This computer as a Device, through the port only: what it reports, and
 * each call a step body makes, over fakes (harnesses, a decider, the MCP
 * fixture server), this computer's own configuration stores (connections
 * and secrets, CLI tools) over the sandbox's Device document, and a real
 * `sh` and git.
 */

/** A `${NAME}` reference, as a connection's env holds it. */
const ref = (name: string) => `\${${name}}`;

const fakeMcp: McpServerConfig = {
	command: process.execPath,
	args: [fixturePath("fake-mcp.ts")],
	env: {},
};

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
/** The knowledge search indexes a test opened. */
const closes: (() => void)[] = [];
afterEach(async () => {
	for (const close of closes.splice(0)) close();
	await sandbox.cleanup();
});

function device({
	harnesses = {},
	...deps
}: Partial<TestDeviceDeps> = {}): Device {
	return localDevice({
		id: "d1",
		name: "studio",
		harnesses: harnessesOf(harnesses),
		...deps,
	});
}

/** Secrets saved on this computer, in memory. */
function memorySecrets(): SecretBackend {
	const values = new Map<string, string>();
	return {
		get: async (name) => values.get(name) ?? null,
		set: async (name, value) => {
			values.set(name, value);
		},
		delete: async (name) => {
			values.delete(name);
		},
	};
}

/**
 * This computer's connections and secrets, as a daemon start opens them:
 * over the sandbox's Device document, with `secrets` saved on this
 * computer and `connections` saved on the Connections page.
 */
async function connectionsHere(
	input: {
		secrets?: Record<string, string>;
		connections?: ConnectionInput[];
		personal?: () => PersonalSecrets | null;
		projects?: () => ProjectSecrets | null;
	} = {},
): Promise<ConnectionStore> {
	const store = createConnectionStore({
		document: await sandbox.openDocument(),
		env: {},
		secrets: memorySecrets(),
		...(input.personal ? { personal: input.personal } : {}),
		...(input.projects ? { projects: input.projects } : {}),
	});
	await store.load();
	for (const [name, value] of Object.entries(input.secrets ?? {})) {
		await store.setSecret(name, value);
	}
	for (const connection of input.connections ?? []) {
		await store.save(connection);
	}
	return store;
}

/** This computer's CLI tools, as a daemon start opens them; `help` is each program's own help. */
async function cliToolsHere(
	names: readonly string[],
	help: (program: string) => Promise<string | null> = async () => null,
): Promise<CliToolStore> {
	const store = createCliToolStore({
		document: await sandbox.openDocument(),
		help,
	});
	await store.load();
	for (const name of names) await store.save({ name });
	return store;
}

/** A Personal or Project secrets port that cannot be reached now. */
const offline = () => {
	throw new Error("offline");
};
const personalOffline = (): PersonalSecrets => ({
	list: offline,
	values: offline,
	set: offline,
	remove: offline,
});
/** The Projects' secrets, as a Host answers them: `values` for each run's Project; the rest is not asked here. */
const projectsOf = (
	values: ProjectSecrets["values"] = offline,
): ProjectSecrets => ({
	list: offline,
	values,
	set: offline,
	remove: offline,
	take: offline,
	kept: offline,
	space: { list: offline, set: offline, remove: offline, take: offline },
});

const noTools = {
	leftOut: [],
	toolsPath: null,
	env: {},
	values: [],
	cleanup: async () => {},
};

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
	const items: T[] = [];
	for await (const item of stream) items.push(item);
	return items;
}

const sessionInput = (extra: Partial<SessionInput> = {}): SessionInput => ({
	harness: "claude-code",
	cwd: "/tmp",
	prompt: "Work.",
	model: "sonnet",
	permissionMode: "acceptEdits",
	signal: new AbortController().signal,
	...extra,
});

describe("what the Device reports", () => {
	test("its id, its name, and that it is online", async () => {
		const d = device();
		expect([d.id, d.name, await d.state()]).toEqual([
			"d1",
			"studio",
			{ online: true },
		]);
	});

	test("the added harnesses, its connections, CLI tools, asked programs and decider", async () => {
		const d = device({
			harnesses: { codex: fakeHarness() },
			connections: await connectionsHere({
				connections: [
					{ name: "jira", server: { url: "http://jira.test/mcp" } },
				],
			}),
			cliTools: await cliToolsHere(["gh"]),
			which: (name) => (name === "gh" ? "/usr/bin/gh" : null),
			decider: fakeDecider([]),
		});
		const caps = await d.capabilities({ programs: ["gh", "jq"] });
		expect(caps).toMatchObject({
			harnesses: ["codex"],
			connections: ["jira"],
			clis: ["gh"],
			programs: { gh: "/usr/bin/gh", jq: null },
			decider: { values: true },
		});
		expect(caps.decider?.defaultModels.openai).toEqual({
			decision: defaultDeciderModel("openai", "decision"),
			value: defaultDeciderModel("openai", "value"),
		});
	});

	test("no decider, or one that makes no values", async () => {
		expect((await device().capabilities()).decider).toBeNull();
		const textless: Decider = {
			defaultModel: defaultDeciderModel,
			decide: async () => ({
				kind: "decided",
				label: "a",
				notes: "",
				costUsd: null,
			}),
		};
		expect(
			(await device({ decider: textless }).capabilities()).decider?.values,
		).toBe(false);
	});

	test("that it sends web requests, reads files, the newest flow format it reads and that it walks a test run", async () => {
		expect(await device().capabilities()).toMatchObject({
			requests: true,
			readFiles: true,
			flowVersion: FLOW_VERSION,
			testRuns: true,
		});
	});
});

describe("session", () => {
	test("refuses a harness that is not added, before it starts anything", async () => {
		const harness = fakeHarness();
		// Another harness is added: the session asks for Claude Code.
		const d = device({ harnesses: { codex: harness } });
		expect(await collect(d.session(sessionInput()))).toEqual([
			{
				type: "refused",
				message: "No Claude Code harness is added. Add it under Agents.",
			},
		]);
		expect(harness.calls).toHaveLength(0);
	});

	test("refuses when a connection cannot be filled in", async () => {
		const harness = fakeHarness();
		const d = device({
			harnesses: { "claude-code": harness },
			connections: await connectionsHere({
				connections: [
					{
						name: "jira",
						server: { command: "jira-mcp", env: { TOKEN: ref("JIRA_TOKEN") } },
					},
				],
			}),
		});
		const events = await collect(
			d.session(sessionInput({ connections: ["jira"] })),
		);
		expect(events).toEqual([
			{
				type: "refused",
				message:
					'The MCP server "jira" needs the secret JIRA_TOKEN, but it is not saved. Save it on the Secrets page, or remove the reference.',
			},
		]);
		expect(harness.calls).toHaveLength(0);
	});

	test("a session under an Offer asks for no Personal secret; its owner's own session may", async () => {
		const uses: [string, unknown][] = [];
		const d = localDevice({
			id: "d1",
			name: "studio",
			harnesses: {
				get: (_name, use) => {
					uses.push(["agent", use]);
					return fakeHarness();
				},
				names: () => [],
			},
			connections: {
				...connectionsOf(),
				mcpServersFor: async (_node, use) => {
					uses.push(["mcp", use]);
					return { ok: true, servers: {} };
				},
			},
			toolLaunchers: {
				prepare: async (_names, use) => {
					uses.push(["tools", use]);
					return { ok: true, ...noTools };
				},
				forCommand: async () => noTools,
				guarded: () => [],
			},
			secretValues: async (use) => {
				uses.push(["mask", use]);
				return [];
			},
		});
		const run = (extra: Partial<SessionInput>) =>
			collect(
				d.session(
					sessionInput({ harness: "acp:goose", clis: ["gh"], ...extra }),
				),
			);
		await run({ underOffer: true });
		expect(uses).toEqual([
			["agent", { underOffer: true }],
			["mcp", { underOffer: true }],
			["tools", { underOffer: true }],
			["mask", { underOffer: true }],
		]);
		uses.length = 0;
		await run({});
		expect(uses.every(([, use]) => JSON.stringify(use) === "{}")).toBe(true);
		// A step of a run reads its Project's secrets first, under an Offer too (ADR 13).
		const step = { spaceId: "space-1", projectId: "app", runId: "run-1" };
		uses.length = 0;
		await run({ underOffer: true, run: step });
		expect(uses.map(([, use]) => use)).toEqual([
			{ run: step, underOffer: true },
			{ run: step, underOffer: true },
			{ run: step, underOffer: true },
			{ run: step, underOffer: true },
		]);
	});

	test("says ready, then starts the harness only when the next event is read", async () => {
		const harness = fakeHarness();
		const d = device({ harnesses: { "claude-code": harness } });
		const stream = d.session(sessionInput())[Symbol.asyncIterator]();
		expect((await stream.next()).value).toEqual({
			type: "ready",
			harness: "claude-code",
		});
		expect(harness.calls).toHaveLength(0);
		const rest: SessionEvent[] = [];
		for (
			let next = await stream.next();
			!next.done;
			next = await stream.next()
		) {
			rest.push(next.value);
		}
		expect(harness.calls).toHaveLength(1);
		expect(rest[0]).toMatchObject({ type: "session" });
		expect(rest.at(-1)?.type).toBe("finished");
	});

	test("hands the harness the expanded servers and a new session's CLI tools", async () => {
		const harness = fakeHarness();
		const asked: string[] = [];
		const d = device({
			harnesses: { "claude-code": harness },
			connections: await connectionsHere({
				connections: [{ name: "tracker", server: fakeMcp }],
			}),
			cliTools: await cliToolsHere(["gh"], async (program) => {
				asked.push(program);
				return `${program} --help`;
			}),
		});
		await collect(
			d.session(sessionInput({ connections: ["tracker"], clis: ["gh"] })),
		);
		await collect(
			d.session(
				sessionInput({ clis: ["gh"], resumeSessionId: "s1", prompt: "Go on." }),
			),
		);
		await collect(
			d.session(sessionInput({ clis: ["gh"], permissionMode: "plan" })),
		);
		const [first, resumed, plan] = harness.calls;
		expect(first?.mcpServers).toEqual({ tracker: fakeMcp });
		expect(first?.clis).toEqual(["gh"]);
		expect(first?.prompt).toStartWith("Work.\n\n## CLI tools");
		expect(resumed?.prompt).toBe("Go on.");
		expect(resumed?.mcpServers).toBeUndefined();
		expect(plan?.prompt).toBe("Work.");
		expect(asked).toEqual(["gh"]);
	});

	test("CLI tools with logins: launchers, git settings and guarded secrets reach the harness; values come back as •••", async () => {
		const harness = fakeHarness({
			steps: [
				{
					type: "tool",
					name: "Bash",
					input: { command: "gh-work auth token" },
					result: "tok-work",
				},
			],
		});
		const prepared: string[][] = [];
		let cleaned = 0;
		const d = device({
			harnesses: { "claude-code": harness },
			toolLaunchers: {
				forCommand: async () => noTools,
				prepare: async (names) => {
					prepared.push([...names]);
					return {
						ok: true,
						leftOut: [],
						toolsPath: "/tmp/nightshift-tools-1",
						env: { GIT_CONFIG_COUNT: "2" },
						values: ["tok-work"],
						cleanup: async () => {
							cleaned += 1;
						},
					};
				},
				guarded: () => ["GH_WORK_TOKEN"],
			},
		});
		const events = await collect(
			d.session(sessionInput({ clis: ["gh-work"] })),
		);
		expect(prepared).toEqual([["gh-work"]]);
		expect(harness.calls[0]).toMatchObject({
			toolsPath: "/tmp/nightshift-tools-1",
			env: { GIT_CONFIG_COUNT: "2" },
			scrubEnv: ["GH_WORK_TOKEN"],
		});
		expect(events).toContainEqual(
			expect.objectContaining({ type: "tool-result", content: "•••" }),
		);
		expect(JSON.stringify(events)).not.toContain("tok-work");
		expect(cleaned).toBe(1);
	});

	test("a CLI tool that cannot run refuses the session; plan mode prepares none", async () => {
		const harness = fakeHarness();
		let prepares = 0;
		const d = device({
			harnesses: { "claude-code": harness },
			toolLaunchers: {
				forCommand: async () => noTools,
				prepare: async () => {
					prepares += 1;
					return { ok: false, message: "The CLI tool gh-work needs GH_WORK." };
				},
				guarded: () => [],
			},
		});
		expect(
			await collect(d.session(sessionInput({ clis: ["gh-work"] }))),
		).toEqual([
			{ type: "refused", message: "The CLI tool gh-work needs GH_WORK." },
		]);
		await collect(
			d.session(sessionInput({ clis: ["gh-work"], permissionMode: "plan" })),
		);
		expect(prepares).toBe(1);
		expect(harness.calls).toHaveLength(1);
		expect(harness.calls[0]?.toolsPath).toBeUndefined();
	});

	test("a session for a step keeps its artifacts in the store, from the worktree", async () => {
		const harness = fakeHarness();
		const saved: unknown[] = [];
		const d = device({
			harnesses: { "claude-code": harness },
			artifacts: {
				save: async (input) => {
					saved.push(input);
					return {
						id: "a1",
						stepId: input.stepId,
						name: "shot.png",
						title: input.title ?? "shot.png",
						mediaType: "image/png",
						size: 1,
						savedAt: 1,
					};
				},
				answerFolder: async () => ({ dir: "/data", paths: [] }),
			},
		});
		await collect(
			d.session(
				sessionInput({
					cwd: "/work",
					artifacts: { runId: "r1", stepId: "s1" },
				}),
			),
		);
		await collect(d.session(sessionInput()));
		const [forStep, plain] = harness.calls;
		expect(forStep && "artifacts" in forStep).toBe(false);
		expect(
			await forStep?.saveArtifact?.({ path: "shot.png", title: "Login" }),
		).toBe('Kept "Login" as an artifact of this run.');
		expect(saved).toEqual([
			{
				runId: "r1",
				stepId: "s1",
				cwd: "/work",
				path: "shot.png",
				title: "Login",
			},
		]);
		expect(plain?.saveArtifact).toBeUndefined();
	});

	test("a session for a step gets the files of the run's answers: in a folder it may read, and a line that says where", async () => {
		const harness = fakeHarness();
		const written: unknown[] = [];
		const d = device({
			harnesses: { "claude-code": harness },
			artifacts: {
				save: async () => {
					throw new Error("not used");
				},
				answerFolder: async (runId, files) => {
					written.push({ runId, names: files.map((file) => file.name) });
					return {
						dir: `/data/artifacts/${runId}/answers`,
						paths: files.map(
							(file) => `/data/artifacts/${runId}/answers/${file.name}`,
						),
					};
				},
			},
		});
		const files = [
			{ name: "spec.md", mediaType: "text/markdown", content: "IyBTcGVj" },
			{ name: "shot.png", mediaType: "image/png", content: "iVBORw==" },
		];
		await collect(
			d.session(
				sessionInput({
					prompt: "Use the spec.",
					artifacts: { runId: "r1", stepId: "s2" },
					files,
				}),
			),
		);
		// Without the step, the Device has nowhere to keep them.
		await collect(d.session(sessionInput({ files })));
		const [forStep, plain] = harness.calls;
		expect(written).toEqual([{ runId: "r1", names: ["spec.md", "shot.png"] }]);
		expect(forStep?.prompt).toBe(
			[
				"Use the spec.",
				"",
				"The person added files to their answers in this run. Read the ones your task needs:",
				"- /data/artifacts/r1/answers/spec.md",
				"- /data/artifacts/r1/answers/shot.png",
			].join("\n"),
		);
		expect(forStep?.addDirs).toEqual(["/data/artifacts/r1/answers"]);
		expect(forStep && "files" in forStep).toBe(false);
		expect(plain?.addDirs).toBeUndefined();
	});

	test("a session for a step gets what the export to monitoring adds to its environment", async () => {
		const harness = fakeHarness();
		const asked: unknown[] = [];
		const d = device({
			harnesses: { "claude-code": harness },
			sessionEnv: (session) => {
				asked.push(session);
				return {
					env: { TRACEPARENT: `00-${session.runId}-${session.stepId}-01` },
					values: [],
					config: { "otel.environment": '"night"' },
				};
			},
		});
		await collect(
			d.session(sessionInput({ artifacts: { runId: "r1", stepId: "s1" } })),
		);
		await collect(d.session(sessionInput()));
		const [forStep, plain] = harness.calls;
		expect(forStep?.env).toEqual({ TRACEPARENT: "00-r1-s1-01" });
		expect(forStep?.harnessConfig).toEqual({ "otel.environment": '"night"' });
		expect(asked).toEqual([
			{ harness: "claude-code", runId: "r1", stepId: "s1" },
		]);
		// A session of no step (the assistant's) gets nothing.
		expect(plain?.env).toBeUndefined();
		expect(plain?.harnessConfig).toBeUndefined();
	});

	test("every secret value the session could see comes back as •••: the export's headers, its MCP servers', the harness's own and the saved secrets", async () => {
		const harness = {
			...fakeHarness({
				steps: [
					{
						type: "tool",
						name: "Bash",
						input: { command: "env" },
						result:
							"OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20glc-otlp-key mcp-key-123 saved-key-456 agent-env-789",
					},
					{ type: "text", text: "The key is glc-otlp-key." },
				],
			}),
			// A custom agent's env, expanded from the environment.
			secretValues: async () => ["agent-env-789"],
		};
		const d = device({
			harnesses: { "claude-code": harness },
			sessionEnv: () => ({
				env: {
					OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer%20glc-otlp-key",
				},
				values: ["glc-otlp-key"],
			}),
			// The connection's `${MCP_KEY}` reads the secret saved here.
			connections: await connectionsHere({
				secrets: { MCP_KEY: "mcp-key-123" },
				connections: [
					{
						name: "tracker",
						server: { ...fakeMcp, env: { KEY: ref("MCP_KEY") } },
					},
				],
			}),
			secretValues: async () => ["saved-key-456"],
		});
		const events = await collect(
			d.session(
				sessionInput({
					connections: ["tracker"],
					artifacts: { runId: "r1", stepId: "s1" },
				}),
			),
		);
		const out = JSON.stringify(events);
		expect(out).toContain("•••");
		for (const value of [
			"glc-otlp-key",
			"mcp-key-123",
			"saved-key-456",
			"agent-env-789",
		]) {
			expect(out).not.toContain(value);
		}
	});
});

describe("the project's knowledge", () => {
	test("a session gets the folder when it has files, or when the node asks; never when it is off", async () => {
		const harness = fakeHarness();
		const { knowledge, folder: folderOf, close } = testKnowledge(sandbox);
		closes.push(close);
		const d = device({ harnesses: { "claude-code": harness }, knowledge });
		const folder = folderOf("p1");
		await collect(d.session(sessionInput({ knowledge: { projectId: "p1" } })));
		await collect(
			d.session(sessionInput({ knowledge: { projectId: "p1", always: true } })),
		);
		await Bun.write(join(folder, "a.md"), "# A\n");
		await collect(d.session(sessionInput({ knowledge: { projectId: "p1" } })));
		await collect(d.session(sessionInput()));
		const [empty, asked, filled, off] = harness.calls;
		expect(empty?.env).toEqual({ NS_KNOWLEDGE: folder });
		expect(empty?.addDirs).toBeUndefined();
		expect(empty?.instructions).toBeUndefined();
		expect(asked?.addDirs).toEqual([folder]);
		expect(filled?.addDirs).toEqual([folder]);
		expect(filled?.instructions).toStartWith(
			`Project knowledge is in ${folder}.`,
		);
		// The step's own prompt stays as it is.
		expect(filled?.prompt).toBe("Work.");
		expect(existsSync(join(folder, "INDEX.md"))).toBe(true);
		expect(off?.env).toBeUndefined();
		expect(off && "knowledge" in off).toBe(false);
	});

	test("a session with only some folders gets a view of those, never the folder", async () => {
		const harness = fakeHarness();
		const { knowledge, folder: folderOf, close } = testKnowledge(sandbox);
		closes.push(close);
		const d = device({ harnesses: { "claude-code": harness }, knowledge });
		const folder = folderOf("p1");
		await Bun.write(join(folder, "books/a.md"), "# A\n");
		await Bun.write(join(folder, "results/r.md"), "# R\n");
		await collect(
			d.session(
				sessionInput({
					knowledgeOnly: { projectId: "p1", folders: ["books"] },
				}),
			),
		);
		const [only] = harness.calls;
		const view = only?.env?.NS_KNOWLEDGE as string;
		expect(view).not.toBe(folder);
		expect(only?.addDirs).toEqual([view]);
		expect(JSON.stringify(only)).not.toContain(folder);
		expect(only && "knowledgeOnly" in only).toBe(false);
		// The view went with the session.
		expect(existsSync(view)).toBe(false);
	});

	test("an agent that reads the knowledge searches it with this computer's index", async () => {
		const harness = fakeHarness({
			steps: [
				{ type: "tool", name: "search_knowledge", input: { query: "quokka" } },
				{ type: "tool", name: "read_knowledge", input: { path: "wiki/a.md" } },
			],
		});
		const { knowledge, folder, close } = testKnowledge(sandbox);
		try {
			await Bun.write(
				join(folder("p1"), "wiki/a.md"),
				"# Animals\n\nThe quokka lives here.\n",
			);
			const d = device({ harnesses: { "claude-code": harness }, knowledge });
			const events = await collect(
				d.session(sessionInput({ knowledge: { projectId: "p1" } })),
			);
			// Without the knowledge, no knowledge tools.
			await collect(d.session(sessionInput()));
			const [on, off] = harness.calls;
			expect(on?.tools?.map((tool) => tool.name)).toEqual([
				"search_knowledge",
				"read_knowledge",
			]);
			expect(on?.toolsInstruction).toContain("search_knowledge");
			// The tools work in the run's project only: they take no project.
			const schema = on?.tools?.[0]?.inputSchema as {
				properties: Record<string, unknown>;
			};
			expect(Object.keys(schema.properties)).toEqual(["query", "limit"]);
			const results = events.flatMap((e) =>
				e.type === "tool-result" ? [e.content] : [],
			);
			expect(results[0]).toContain('"path": "wiki/a.md"');
			expect(results[0]).toContain("**quokka**");
			expect(results[1]).toStartWith("wiki/a.md: Animals\n\n# Animals");
			expect(off?.tools).toBeUndefined();
			expect(off?.toolsInstruction).toBeUndefined();
		} finally {
			close();
		}
	});

	test("an agent that reads the knowledge may propose learnings: they wait for a person", async () => {
		const learned = {
			type: "event" as const,
			event: {
				type: "report" as const,
				outcome: "pass",
				summary: "Done.",
				learnings: ["The tests need a database."],
			},
		};
		const harness = fakeHarness({ steps: [learned] });
		const { knowledge, folder, close } = testKnowledge(sandbox);
		closes.push(close);
		await Bun.write(join(folder("p1"), "a.md"), "# A\n");
		const d = device({ harnesses: { "claude-code": harness }, knowledge });
		const forStep = {
			knowledge: { projectId: "p1" },
			artifacts: { runId: "run-1", stepId: "s1" },
			stepReport: true as const,
		};
		await collect(d.session(sessionInput(forStep)));
		await collect(d.session(sessionInput(forStep)));
		// Without the knowledge, no learnings are asked for or kept.
		await collect(
			d.session(sessionInput({ ...forStep, knowledge: undefined })),
		);
		const [first, , off] = harness.calls;
		expect(first?.stepReport).toEqual({ learnings: true });
		expect(off?.stepReport).toBe(true);
		const proposed = await Bun.file(
			join(folder("p1"), "learnings/proposed/run-1.s1.md"),
		).text();
		expect(proposed).toStartWith("# Learnings of run run-1\n");
		expect(
			proposed.split("\n").filter((line) => line.startsWith("- ")),
		).toEqual(["- The tests need a database.", "- The tests need a database."]);
		// The index lists accepted learnings only.
		expect(await Bun.file(join(folder("p1"), "INDEX.md")).text()).not.toContain(
			"learnings/proposed",
		);
	});

	test("a step holds the project's folder from its start to its end, also when it fails to start", async () => {
		const seen: string[] = [];
		const knowledge = {
			forCommand: async (projectId: string) => {
				seen.push(`start ${projectId}`);
				return {
					env: { NS_KNOWLEDGE: "/k" },
					done: async () => void seen.push(`done ${projectId}`),
				};
			},
			forSession: async () => {
				throw new Error("Not a session.");
			},
		};
		await collect(
			device({ knowledge }).exec({
				command: "echo writing",
				cwd: sandbox.repoPath,
				knowledge: { projectId: "p1" },
				signal: new AbortController().signal,
			}),
		);
		expect(seen).toEqual(["start p1", "done p1"]);
		const broken = device({
			knowledge,
			toolLaunchers: {
				prepare: async () => ({ ok: true, ...noTools }),
				guarded: () => [],
				forCommand: async () => {
					throw new Error("No launchers.");
				},
			},
		});
		await expect(
			collect(
				broken.exec({
					command: "true",
					cwd: sandbox.repoPath,
					knowledge: { projectId: "p1" },
					signal: new AbortController().signal,
				}),
			),
		).rejects.toThrow("No launchers.");
		expect(seen).toEqual(["start p1", "done p1", "start p1", "done p1"]);
	});

	test("a command gets the folder in NS_KNOWLEDGE, made for it", async () => {
		const { knowledge, folder, close } = testKnowledge(sandbox);
		closes.push(close);
		const events = await collect(
			device({ knowledge }).exec({
				command: 'test -d "$NS_KNOWLEDGE" && printf "%s" "$NS_KNOWLEDGE"',
				cwd: sandbox.repoPath,
				knowledge: { projectId: "p1" },
				signal: new AbortController().signal,
			}),
		);
		expect(events[0]).toEqual({
			type: "output",
			stream: "stdout",
			text: folder("p1"),
		});
	});
});

describe("exec", () => {
	test("streams each chunk of output, then one exit, in the given folder with the given env", async () => {
		const events = await collect(
			device().exec({
				command: 'printf "%s" "$GREETING"; pwd; echo oops >&2; exit 3',
				cwd: sandbox.repoPath,
				env: { GREETING: "hi " },
				signal: new AbortController().signal,
			}),
		);
		const out = (stream: "stdout" | "stderr") =>
			events
				.filter(
					(e): e is Extract<ExecEvent, { type: "output" }> =>
						e.type === "output" && e.stream === stream,
				)
				.map((e) => e.text)
				.join("");
		expect(out("stdout")).toBe(`hi ${sandbox.repoPath}\n`);
		expect(out("stderr")).toBe("oops\n");
		expect(events.at(-1)).toEqual({
			type: "exit",
			exitCode: 3,
			spawnError: null,
		});
		expect(events.filter((e) => e.type === "exit")).toHaveLength(1);
	});

	test("a command never sees the export's OTLP headers: only an agent's harness gets them", async () => {
		const d = device({
			sessionEnv: () => ({
				env: { OTEL_EXPORTER_OTLP_HEADERS: "api-key=secret-1" },
				values: ["secret-1"],
			}),
		});
		const events = await collect(
			d.exec({
				command: 'printf "%s" "${OTEL_EXPORTER_OTLP_HEADERS-none}"',
				cwd: sandbox.repoPath,
				signal: new AbortController().signal,
			}),
		);
		expect(
			events.flatMap((e) => (e.type === "output" ? [e.text] : [])).join(""),
		).toBe("none");
	});

	test("the files a step's command puts in NS_ARTIFACTS become artifacts of the step, and the folder goes", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "ns-artifacts-test-"));
		try {
			const store = createArtifactStore(dataDir);
			const d = device({ artifacts: store });
			const events = await collect(
				d.exec({
					command: [
						'printf "%s" "$NS_ARTIFACTS" > folder.txt',
						'printf png > "$NS_ARTIFACTS/b-design.png"',
						'mkdir "$NS_ARTIFACTS/notes"',
						'printf hi > "$NS_ARTIFACTS/notes/a.md"',
					].join(" && "),
					cwd: sandbox.repoPath,
					artifacts: { runId: "r1", stepId: "s1" },
					signal: new AbortController().signal,
				}),
			);
			expect(events.at(-1)).toMatchObject({ type: "exit", exitCode: 0 });
			const kept = await store.list("r1");
			expect(
				kept.map(({ stepId, title, mediaType, size }) => ({
					stepId,
					title,
					mediaType,
					size,
				})),
			).toEqual([
				{
					stepId: "s1",
					title: "b-design.png",
					mediaType: "image/png",
					size: 3,
				},
				{
					stepId: "s1",
					title: join("notes", "a.md"),
					mediaType: "text/markdown",
					size: 2,
				},
			]);
			const folder = readFileSync(join(sandbox.repoPath, "folder.txt"), "utf8");
			expect(folder).not.toBe("");
			expect(existsSync(folder)).toBe(false);
		} finally {
			rmSync(dataDir, { recursive: true, force: true });
		}
	});

	test("a command that runs for no step gets no NS_ARTIFACTS", async () => {
		const events = await collect(
			device({ artifacts: createArtifactStore(sandbox.repoPath) }).exec({
				command: 'printf "%s" "${NS_ARTIFACTS-none}"',
				cwd: sandbox.repoPath,
				signal: new AbortController().signal,
			}),
		);
		expect(
			events.flatMap((e) => (e.type === "output" ? [e.text] : [])).join(""),
		).toBe("none");
	});

	test("an abort kills the command: the exit has no code", async () => {
		const controller = new AbortController();
		const stream = device().exec({
			command: "echo started; sleep 30",
			cwd: sandbox.repoPath,
			signal: controller.signal,
		});
		const events: ExecEvent[] = [];
		for await (const event of stream) {
			events.push(event);
			if (event.type === "output") controller.abort();
		}
		expect(events.at(-1)).toEqual({
			type: "exit",
			exitCode: null,
			spawnError: null,
		});
	});

	/** This computer's connections, with these secrets saved on it. */
	const secrets = async (
		values: Record<string, string>,
	): Promise<Partial<TestDeviceDeps>> => ({
		connections: await connectionsHere({ secrets: values }),
	});

	test("a secret reaches the command under its own name, and its value comes back as •••", async () => {
		const events = await collect(
			device(await secrets({ API_USER: "jdoe", API_PASSWORD: "s3cr3t!" })).exec(
				{
					command:
						'[ "$API_PASSWORD" = "s3cr3t!" ] && echo "user $API_USER pass $API_PASSWORD" && echo "$API_PASSWORD" >&2',
					cwd: sandbox.repoPath,
					secrets: ["API_USER", "API_PASSWORD"],
					signal: new AbortController().signal,
				},
			),
		);
		const out = (stream: "stdout" | "stderr") =>
			events
				.flatMap((e) =>
					e.type === "output" && e.stream === stream ? [e.text] : [],
				)
				.join("");
		expect(out("stdout")).toBe("user ••• pass •••\n");
		expect(out("stderr")).toBe("•••\n");
		expect(events.at(-1)).toEqual({
			type: "exit",
			exitCode: 0,
			spawnError: null,
		});
	});

	test("a secret that a login reads does not reach a command, unless the command names it", async () => {
		const previous = process.env.NIGHTSHIFT_TEST_LOGIN;
		process.env.NIGHTSHIFT_TEST_LOGIN = "from-env";
		try {
			const d = device({
				...(await secrets({ NIGHTSHIFT_TEST_LOGIN: "from-env" })),
				toolLaunchers: {
					prepare: async () => ({ ok: false, message: "unused" }),
					forCommand: async () => noTools,
					guarded: () => ["NIGHTSHIFT_TEST_LOGIN"],
				},
			});
			const output = async (named: string[]) =>
				(
					await collect(
						d.exec({
							command: 'printf "%s" "${NIGHTSHIFT_TEST_LOGIN:-none}"',
							cwd: sandbox.repoPath,
							secrets: named,
							signal: new AbortController().signal,
						}),
					)
				)
					.flatMap((e) => (e.type === "output" ? [e.text] : []))
					.join("");
			expect(await output([])).toBe("none");
			expect(await output(["NIGHTSHIFT_TEST_LOGIN"])).toBe("•••");
		} finally {
			if (previous === undefined) delete process.env.NIGHTSHIFT_TEST_LOGIN;
			else process.env.NIGHTSHIFT_TEST_LOGIN = previous;
		}
	});

	test("a CLI tool with a login runs as that tool, its values come back as •••, and its launchers go after", async () => {
		const folder = join(sandbox.repoPath, "launchers");
		await Bun.write(
			join(folder, "gh"),
			'#!/bin/sh\nprintf "%s|%s" "$1" "tok-me"\n',
		);
		await Bun.$`chmod 755 ${join(folder, "gh")}`;
		let cleaned = false;
		const events = await collect(
			device({
				toolLaunchers: {
					prepare: async () => ({ ok: false, message: "unused" }),
					forCommand: async () => ({
						toolsPath: folder,
						leftOut: [],
						env: { GIT_CONFIG_COUNT: "0" },
						values: ["tok-me"],
						cleanup: async () => {
							cleaned = true;
						},
					}),
					guarded: () => [],
				},
			}).exec({
				command: 'gh api; printf " %s" "$GIT_CONFIG_COUNT"',
				cwd: sandbox.repoPath,
				signal: new AbortController().signal,
			}),
		);
		expect(
			events.flatMap((e) => (e.type === "output" ? [e.text] : [])).join(""),
		).toBe("api|••• 0");
		expect(cleaned).toBe(true);
	});

	test("a command's tools read the scopes of its run", async () => {
		const uses: unknown[] = [];
		const step = { spaceId: "s", projectId: "p", runId: "r" };
		await collect(
			device({
				toolLaunchers: {
					prepare: async () => ({ ok: false, message: "unused" }),
					forCommand: async (use) => {
						uses.push(use);
						return noTools;
					},
					guarded: () => [],
				},
			}).exec({
				command: "true",
				cwd: sandbox.repoPath,
				run: step,
				signal: new AbortController().signal,
			}),
		);
		expect(uses).toEqual([{ run: step }]);
	});

	test("a failed command says why a tool it names could not run, and no other", async () => {
		const tools = {
			toolLaunchers: {
				prepare: async () => ({ ok: false as const, message: "unused" }),
				forCommand: async () => ({
					...noTools,
					leftOut: [
						{ tool: "acli-work", message: "Save ACLI_TOKEN." },
						{ tool: "acli", message: "Not this one." },
					],
				}),
				guarded: () => [],
			},
		};
		const textOf = (events: readonly { type: string; text?: string }[]) =>
			events.flatMap((e) => (e.type === "output" ? [e.text] : [])).join("");
		const failed = await collect(
			device(tools).exec({
				command: "acli-work jira; exit 127",
				cwd: sandbox.repoPath,
				signal: new AbortController().signal,
			}),
		);
		expect(textOf(failed)).toContain("Save ACLI_TOKEN.\n");
		expect(textOf(failed)).not.toContain("Not this one.");
		const passed = await collect(
			device(tools).exec({
				command: "echo acli-work",
				cwd: sandbox.repoPath,
				signal: new AbortController().signal,
			}),
		);
		expect(textOf(passed)).toBe("acli-work\n");
	});

	test("a secret this computer does not have refuses the command before it starts", async () => {
		const marker = join(sandbox.repoPath, "ran");
		const events = await collect(
			device(await secrets({ API_USER: "jdoe" })).exec({
				command: `touch ${marker}`,
				cwd: sandbox.repoPath,
				secrets: ["API_USER", "API_PASSWORD"],
				signal: new AbortController().signal,
			}),
		);
		expect(events).toEqual([
			{
				type: "refused",
				message:
					"The command needs the secret API_PASSWORD, but it is not saved. Save it on the Secrets page, or remove it from the node.",
			},
		]);
		expect(existsSync(marker)).toBe(false);
	});

	test("a Personal secret that cannot be read now refuses the command, and says why", async () => {
		const events = await collect(
			device({
				connections: await connectionsHere({ personal: personalOffline }),
			}).exec({
				command: "true",
				cwd: sandbox.repoPath,
				secrets: ["GH_TOKEN"],
				signal: new AbortController().signal,
			}),
		);
		expect(events).toEqual([
			{
				type: "refused",
				message:
					"The command needs the secret GH_TOKEN, but it is not saved. Save it on the Secrets page, or remove it from the node. Night Shift could not read your Personal secrets now. Check that this computer is online, then try again.",
			},
		]);
	});

	const run = { spaceId: "space-1", projectId: "app", runId: "run-1" };

	test("a command of a run reads its Project's secrets: a Project secret counts as saved", async () => {
		const asked: unknown[] = [];
		const events = await collect(
			device({
				// Only the run's Project has DB_URL (ADR 13).
				connections: await connectionsHere({
					projects: () =>
						projectsOf(async (step): Promise<Record<string, string>> => {
							asked.push(step);
							return step.projectId === "app" ? { DB_URL: "postgres://x" } : {};
						}),
				}),
			}).exec({
				command: 'echo "url $DB_URL"',
				cwd: sandbox.repoPath,
				secrets: ["DB_URL"],
				run,
				signal: new AbortController().signal,
			}),
		);
		expect(asked).toEqual([run]);
		expect(events).toContainEqual({
			type: "output",
			stream: "stdout",
			text: "url •••\n",
		});
		expect(events.at(-1)).toMatchObject({ type: "exit", exitCode: 0 });
	});

	test("a Project's secrets that cannot be read now refuse the command, and say why", async () => {
		const events = await collect(
			device({
				connections: await connectionsHere({ projects: () => projectsOf() }),
			}).exec({
				command: "true",
				cwd: sandbox.repoPath,
				secrets: ["DB_URL"],
				run,
				signal: new AbortController().signal,
			}),
		);
		expect(events).toEqual([
			{
				type: "refused",
				message:
					"The command needs the secret DB_URL, but it is not saved. Save it on the Secrets page, or remove it from the node. Night Shift could not read this project's secrets now. Check that this computer is online, then try again.",
			},
		]);
	});
});

describe("callTool", () => {
	/** This computer with the connection "tracker": the MCP fixture server. */
	const tracker = async (): Promise<Partial<TestDeviceDeps>> => ({
		connections: await connectionsHere({
			connections: [{ name: "tracker", server: fakeMcp }],
		}),
	});
	const signal = () => new AbortController().signal;

	test("a tool call of a run expands its connection with the run's Project secrets", async () => {
		const uses: unknown[] = [];
		const run = { spaceId: "space-1", projectId: "app", runId: "run-1" };
		await device({
			connections: {
				...connectionsOf(),
				mcpServersFor: async (_node, use) => {
					uses.push(use);
					return { ok: false, message: "No such connection." };
				},
			},
		}).callTool({
			connection: "jira",
			tool: "say",
			arguments: {},
			run,
			signal: signal(),
		});
		expect(uses).toEqual([{ run }]);
	});

	test("refuses a connection it cannot resolve, without calling anything", async () => {
		expect(
			await device(await tracker()).callTool({
				connection: "jira",
				tool: "say",
				arguments: {},
				signal: signal(),
			}),
		).toEqual({
			kind: "refused",
			message:
				'There is no connection named "jira". Add it under Agents → Tools, or remove it from the node.',
		});
	});

	test("calls the tool with the arguments typed by its schema", async () => {
		const result = await device(await tracker()).callTool({
			connection: "tracker",
			tool: "list_json",
			arguments: { count: "1" },
			signal: signal(),
		});
		expect(result).toEqual({
			kind: "called",
			arguments: { count: 1 },
			text: '[{"n":1}]',
			structuredContent: null,
			isError: false,
		});
	});

	test("a tool the server does not have fails before any arguments are sent", async () => {
		const result = await device(await tracker()).callTool({
			connection: "tracker",
			tool: "nope",
			arguments: {},
			signal: signal(),
		});
		expect(result).toMatchObject({ kind: "failed", arguments: null });
		expect(result.kind === "failed" && result.message).toStartWith(
			'The connection "tracker" has no tool named "nope". It has: ',
		);
	});
});

describe("decide", () => {
	const signal = new AbortController().signal;

	test("asks the decider for a decision or a value", async () => {
		const d = device({
			decider: fakeDecider([{ label: "ship", notes: "ok" }], {
				values: [{ data: { n: 1 } }],
			}),
		});
		expect(
			await d.decide({
				decider: "openai",
				prompt: "Ship?",
				labels: [{ name: "ship" }],
				signal,
			}),
		).toMatchObject({ kind: "decided", label: "ship" });
		expect(
			await d.decide({
				decider: "openai",
				prompt: "Count.",
				output: { type: "object" },
				signal,
			}),
		).toMatchObject({ kind: "made", data: { n: 1 } });
	});

	test("without a decider it answers an error", async () => {
		expect(
			await device().decide({
				decider: "openai",
				prompt: "Ship?",
				labels: [],
				signal,
			}),
		).toMatchObject({
			kind: "error",
			message: "No decider is configured for Decision nodes.",
		});
		expect(
			await device().decide({
				decider: "openai",
				prompt: "x",
				output: {},
				signal,
			}),
		).toMatchObject({
			kind: "error",
			message: "No decider is configured for Value nodes.",
		});
	});
});

describe("worktree", () => {
	test("adds the run's worktree on its own branch beside the clone", async () => {
		const worktree = await device({
			clonePath: async (projectId) =>
				projectId === "project-1" ? sandbox.repoPath : null,
		}).worktree({
			id: "abcdef12-0000-0000-0000-000000000000",
			projectId: "project-1",
		});
		expect(worktree).toEqual({
			worktreePath: join(sandbox.root, "repo.nightshift", "abcdef12"),
			branch: "nightshift/abcdef12",
			baseRef: (await mustGit(sandbox.repoPath, ["rev-parse", "HEAD"])).trim(),
		});
		expect(existsSync(join(worktree.worktreePath, "README.md"))).toBe(true);
	});
});

describe("runFolder", () => {
	test("makes the run's own empty folder in the data folder once, with no branch and no base (ADR 22)", async () => {
		const runFolders = createRunFolders(sandbox.dataDir);
		const run = { id: "abcdef12-0000-0000-0000-000000000000", projectId: "p" };
		const here = device({ runFolders });
		expect(await here.runFolder?.(run)).toEqual({
			worktreePath: runFolders.path(run.id),
			branch: "",
			baseRef: "",
			made: true,
		});
		expect(existsSync(runFolders.path(run.id))).toBe(true);
		expect((await here.runFolder?.(run))?.made).toBe(false);
		// Without the run folders, this computer cannot run such a project.
		expect(device().runFolder).toBeUndefined();
	});
});
