import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defaultDeciderModel } from "@nightshift/agents";
import {
	fakeDecider,
	fakeHarness,
	fixturePath,
} from "@nightshift/agents/testing";
import type { Decider, McpServerConfig } from "@nightshift/agents/types";

import { createSandbox, mustGit, type Sandbox } from "../testing/test-support";
import { type LocalDeviceDeps, localDevice } from "./local";
import type { Device, ExecEvent, SessionEvent, SessionInput } from "./types";

/**
 * This computer as a Device, through the port only: what it reports, and
 * each call a step body makes, over fakes (harnesses, a decider, the MCP
 * fixture server) and a real `sh` and git.
 */

const fakeMcp: McpServerConfig = {
	command: process.execPath,
	args: [fixturePath("fake-mcp.ts")],
	env: {},
};

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

function device(deps: Partial<LocalDeviceDeps> = {}): Device {
	return localDevice({ id: "d1", name: "studio", harnesses: {}, ...deps });
}

const noTools = {
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
			harnesses: { "claude-code": fakeHarness(), codex: fakeHarness() },
			harnessNames: () => new Set(["codex"]),
			connectionNames: () => new Set(["jira"]),
			cliNames: () => new Set(["gh"]),
			findCli: (name) => (name === "gh" ? "/usr/bin/gh" : null),
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
});

describe("session", () => {
	test("refuses a harness that is not added, before it starts anything", async () => {
		const harness = fakeHarness();
		const d = device({
			harnesses: { "claude-code": harness },
			harnessNames: () => new Set(),
		});
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
			mcpServersFor: async () => ({ ok: false, message: "Save JIRA_TOKEN." }),
		});
		const events = await collect(
			d.session(sessionInput({ connections: ["jira"] })),
		);
		expect(events).toEqual([{ type: "refused", message: "Save JIRA_TOKEN." }]);
		expect(harness.calls).toHaveLength(0);
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
		const asked: string[][] = [];
		const d = device({
			harnesses: { "claude-code": harness },
			mcpServersFor: async (node) => ({
				ok: true,
				servers: Object.fromEntries(
					(node.connections ?? []).map((c) => [c, fakeMcp]),
				),
			}),
			cliToolsFor: async (names) => {
				asked.push([...names]);
				return names.map((name) => ({
					name,
					description: null,
					help: `${name} --help`,
				}));
			},
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
		expect(asked).toEqual([["gh"]]);
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

	const secrets = (
		values: Record<string, string>,
	): Partial<LocalDeviceDeps> => ({
		secretEnv: async (names) => {
			const missing = names.filter((name) => values[name] === undefined);
			return missing.length > 0
				? { ok: false, missing }
				: {
						ok: true,
						env: Object.fromEntries(
							names.map((name) => [name, values[name] ?? ""]),
						),
					};
		},
	});

	test("a secret reaches the command under its own name, and its value comes back as •••", async () => {
		const events = await collect(
			device(
				secrets({ ZAC_USER: "behandelaar", ZAC_PASSWORD: "s3cr3t!" }),
			).exec({
				command:
					'[ "$ZAC_PASSWORD" = "s3cr3t!" ] && echo "user $ZAC_USER pass $ZAC_PASSWORD" && echo "$ZAC_PASSWORD" >&2',
				cwd: sandbox.repoPath,
				secrets: ["ZAC_USER", "ZAC_PASSWORD"],
				signal: new AbortController().signal,
			}),
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
				...secrets({ NIGHTSHIFT_TEST_LOGIN: "from-env" }),
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

	test("a secret this computer does not have refuses the command before it starts", async () => {
		const marker = join(sandbox.repoPath, "ran");
		const events = await collect(
			device(secrets({ ZAC_USER: "behandelaar" })).exec({
				command: `touch ${marker}`,
				cwd: sandbox.repoPath,
				secrets: ["ZAC_USER", "ZAC_PASSWORD"],
				signal: new AbortController().signal,
			}),
		);
		expect(events).toEqual([
			{
				type: "refused",
				message:
					"The command needs the secret ZAC_PASSWORD, but it is not saved. Save it under Agents → Secrets, or remove it from the node.",
			},
		]);
		expect(existsSync(marker)).toBe(false);
	});
});

describe("callTool", () => {
	const tracker = (): Partial<LocalDeviceDeps> => ({
		mcpServersFor: async (node) =>
			(node.connections ?? []).includes("tracker")
				? { ok: true, servers: { tracker: fakeMcp } }
				: { ok: false, message: "No such connection." },
	});
	const signal = () => new AbortController().signal;

	test("refuses a connection it cannot resolve, without calling anything", async () => {
		expect(
			await device(tracker()).callTool({
				connection: "jira",
				tool: "say",
				arguments: {},
				signal: signal(),
			}),
		).toEqual({ kind: "refused", message: "No such connection." });
	});

	test("calls the tool with the arguments typed by its schema", async () => {
		const result = await device(tracker()).callTool({
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
		const result = await device(tracker()).callTool({
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
