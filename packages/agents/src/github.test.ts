import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeBin } from "./fixtures/bin";
import {
	GITHUB_TOOL_IDS,
	GITHUB_TOOL_NAMES,
	githubTools,
	summarizeChecks,
} from "./github";
import type { EffectJournal } from "./types";

type LogEntry = { tool: string; argv: string[]; stdin: string; cwd: string };
type Rule = {
	tool: "gh" | "git";
	args: string[];
	stdout?: string;
	stderr?: string;
	code?: number;
};

let dir: string;
let cwd: string;
let logFile: string;
let rulesFile: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-gh-"));
	cwd = await mkdtemp(join(tmpdir(), "nightshift-worktree-"));
	logFile = join(dir, "log.jsonl");
	rulesFile = join(dir, "rules.json");
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
	await rm(cwd, { recursive: true, force: true });
});

async function setup(rules: Rule[] = [], effects?: EffectJournal) {
	await writeFile(rulesFile, JSON.stringify(rules));
	const env = { FAKE_LOG: logFile, FAKE_RULES: rulesFile };
	const gh = await fakeBin(dir, "gh", "fake-gh", { ...env, FAKE_TOOL: "gh" });
	const git = await fakeBin(dir, "git", "fake-gh", {
		...env,
		FAKE_TOOL: "git",
	});
	const tools = githubTools({ cwd, gh, git, ...(effects ? { effects } : {}) });
	const call = (name: string, args: unknown) => {
		const tool = tools.find((t) => t.name === name);
		if (!tool?.execute) throw new Error(`no tool ${name}`);
		return (tool.execute as (args: unknown) => Promise<unknown>)(args);
	};
	return { tools, call };
}

async function readLog(): Promise<LogEntry[]> {
	try {
		const text = await readFile(logFile, "utf8");
		return text
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	} catch {
		return [];
	}
}

describe("githubTools", () => {
	test("has the six tools, with zod-derived JSON schemas", async () => {
		const { tools } = await setup();
		expect(tools.map((t) => t.name)).toEqual([...GITHUB_TOOL_NAMES]);
		expect(GITHUB_TOOL_IDS).toContain("mcp__tanstack__github_read_issue");
		expect(GITHUB_TOOL_IDS).toHaveLength(6);
	});

	test("read_issue: argv, cwd, and the mapped issue", async () => {
		const { call } = await setup([
			{
				tool: "gh",
				args: ["issue", "view", "12"],
				stdout: JSON.stringify({
					number: 12,
					title: "Fix it",
					body: "Body",
					state: "OPEN",
					url: "https://github.com/o/r/issues/12",
					labels: [{ name: "bug", color: "red" }],
					comments: [
						{
							author: { login: "sander" },
							body: "First",
							createdAt: "2026-10-01T00:00:00Z",
						},
					],
				}),
			},
		]);
		const result = await call("github_read_issue", { number: 12 });
		expect(result).toEqual({
			number: 12,
			title: "Fix it",
			state: "OPEN",
			url: "https://github.com/o/r/issues/12",
			labels: ["bug"],
			body: "Body",
			comments: [
				{ author: "sander", createdAt: "2026-10-01T00:00:00Z", body: "First" },
			],
		});
		const [entry] = await readLog();
		expect(entry?.argv).toEqual([
			"issue",
			"view",
			"12",
			"--json",
			"number,title,body,state,labels,comments,url",
		]);
		expect(entry?.cwd).toEndWith(cwd.split("/").at(-1) ?? "");
	});

	test("list_issues: defaults, a label, and label names", async () => {
		const { call } = await setup([
			{
				tool: "gh",
				args: ["issue", "list"],
				stdout: JSON.stringify([
					{
						number: 3,
						title: "T",
						state: "OPEN",
						url: "u",
						labels: [{ name: "night" }],
					},
				]),
			},
		]);
		expect(await call("github_list_issues", {})).toEqual([
			{ number: 3, title: "T", state: "OPEN", url: "u", labels: ["night"] },
		]);
		await call("github_list_issues", {
			state: "all",
			label: "needs input",
			limit: 5,
		});
		const log = await readLog();
		expect(log.map((e) => e.argv)).toEqual([
			[
				"issue",
				"list",
				"--state=open",
				"--limit=30",
				"--json",
				"number,title,state,labels,url",
			],
			[
				"issue",
				"list",
				"--state=all",
				"--limit=5",
				"--label=needs input",
				"--json",
				"number,title,state,labels,url",
			],
		]);
	});

	test("comment: the body goes on stdin, never in argv", async () => {
		const { call } = await setup([
			{
				tool: "gh",
				args: ["issue", "comment", "7"],
				stdout: "https://github.com/o/r/issues/7#issuecomment-1\n",
			},
		]);
		const body =
			'Done. $(rm -rf ~) `whoami` "quoted" --repo=evil\n; echo pwned';
		expect(await call("github_comment", { number: 7, body })).toEqual({
			number: 7,
			url: "https://github.com/o/r/issues/7#issuecomment-1",
		});
		const [entry] = await readLog();
		expect(entry?.argv).toEqual(["issue", "comment", "7", "--body-file", "-"]);
		expect(entry?.stdin).toBe(body);
	});

	test("comment: posted once per step; a repeat gets the first one back", async () => {
		const { call } = await setup(
			[
				{
					tool: "gh",
					args: ["issue", "comment", "7"],
					stdout: "https://github.com/o/r/issues/7#issuecomment-1\n",
				},
			],
			memoryJournal(),
		);
		const first = await call("github_comment", { number: 7, body: "Done." });
		expect(first).toEqual({
			number: 7,
			url: "https://github.com/o/r/issues/7#issuecomment-1",
		});
		expect(await call("github_comment", { number: 7, body: "Done." })).toEqual({
			...(first as object),
			alreadyPosted: true,
		});
		await call("github_comment", { number: 7, body: "Another." });
		expect((await readLog()).map((e) => e.stdin)).toEqual([
			"Done.",
			"Another.",
		]);
	});

	test("comment: started but not recorded, it looks for the comment before posting", async () => {
		const body = "Line one\nLine two";
		const listed = [
			["https://github.com/o/r/issues/7#issuecomment-1", "Other"],
			["https://github.com/o/r/issues/7#issuecomment-2", body],
		]
			.map((entry) => JSON.stringify(entry))
			.join("\n");
		const { call } = await setup(
			[{ tool: "gh", args: ["api"], stdout: `${listed}\n` }],
			memoryJournal({ started: true }),
		);
		expect(await call("github_comment", { number: 7, body })).toEqual({
			number: 7,
			url: "https://github.com/o/r/issues/7#issuecomment-2",
			alreadyPosted: true,
		});
		const log = await readLog();
		expect(log.map((e) => e.argv.slice(0, 2))).toEqual([
			["api", "repos/{owner}/{repo}/issues/7/comments"],
		]);
	});

	test("comment: started but not found, it posts", async () => {
		const { call } = await setup(
			[
				{ tool: "gh", args: ["api"], stdout: "" },
				{
					tool: "gh",
					args: ["issue", "comment", "7"],
					stdout: "https://github.com/o/r/issues/7#issuecomment-3\n",
				},
			],
			memoryJournal({ started: true }),
		);
		expect(await call("github_comment", { number: 7, body: "Done." })).toEqual({
			number: 7,
			url: "https://github.com/o/r/issues/7#issuecomment-3",
		});
		expect((await readLog()).map((e) => e.argv[0])).toEqual(["api", "issue"]);
	});

	test("set_labels: add and remove lists", async () => {
		const { call } = await setup();
		expect(
			await call("github_set_labels", {
				number: 4,
				add: ["ready", "night shift"],
				remove: ["blocked"],
			}),
		).toEqual({
			number: 4,
			added: ["ready", "night shift"],
			removed: ["blocked"],
		});
		await call("github_set_labels", { number: 4, remove: ["x"] });
		expect((await readLog()).map((e) => e.argv)).toEqual([
			[
				"issue",
				"edit",
				"4",
				"--add-label=ready,night shift",
				"--remove-label=blocked",
			],
			["issue", "edit", "4", "--remove-label=x"],
		]);
	});

	test("invalid input is a tool error and runs nothing", async () => {
		const { call } = await setup();
		await expect(
			call("github_set_labels", { number: 4, add: [], remove: [] }),
		).rejects.toThrow(/at least one label/);
		await expect(
			call("github_set_labels", { number: 4, add: ["a,b"] }),
		).rejects.toThrow(/comma/);
		await expect(call("github_read_issue", { number: "12" })).rejects.toThrow(
			/Invalid input/,
		);
		await expect(
			call("github_comment", { number: 1, body: "" }),
		).rejects.toThrow(/Invalid input/);
		expect(await readLog()).toEqual([]);
	});

	test("a failed gh call is a tool error with gh's stderr", async () => {
		const { call } = await setup([
			{
				tool: "gh",
				args: ["issue", "view"],
				stderr:
					"GraphQL: Could not resolve to an issue or pull request with the number of 999.\n",
				code: 1,
			},
		]);
		await expect(call("github_read_issue", { number: 999 })).rejects.toThrow(
			"gh issue view failed (exit 1): GraphQL: Could not resolve to an issue or pull request with the number of 999.",
		);
	});

	test("a missing gh is a tool error", async () => {
		const tools = githubTools({ cwd, gh: join(dir, "no-such-gh") });
		const execute = tools.find((t) => t.name === "github_read_issue")
			?.execute as (args: unknown) => Promise<unknown>;
		await expect(execute({ number: 1 })).rejects.toThrow(/not found/);
	});

	test("read_pr: checks summary and review decision", async () => {
		const { call } = await setup([
			{
				tool: "gh",
				args: ["pr", "view", "9"],
				stdout: JSON.stringify({
					number: 9,
					title: "PR",
					body: "B",
					state: "OPEN",
					isDraft: false,
					url: "https://github.com/o/r/pull/9",
					headRefName: "feat",
					baseRefName: "main",
					reviewDecision: "CHANGES_REQUESTED",
					statusCheckRollup: [
						{
							__typename: "CheckRun",
							name: "test",
							status: "COMPLETED",
							conclusion: "FAILURE",
						},
						{
							__typename: "CheckRun",
							name: "lint",
							status: "COMPLETED",
							conclusion: "SUCCESS",
						},
						{ __typename: "CheckRun", name: "e2e", status: "IN_PROGRESS" },
						{ __typename: "StatusContext", context: "ci/x", state: "SUCCESS" },
					],
				}),
			},
		]);
		const result = (await call("github_read_pr", { number: 9 })) as Record<
			string,
			unknown
		>;
		expect(result.reviewDecision).toBe("CHANGES_REQUESTED");
		expect(result.head).toBe("feat");
		expect(result.checks).toEqual({
			state: "failing",
			total: 4,
			passed: 2,
			failed: 1,
			pending: 1,
			skipped: 0,
			failing: ["test"],
		});
		const [entry] = await readLog();
		expect(entry?.argv.slice(0, 4)).toEqual(["pr", "view", "9", "--json"]);
	});

	test("summarizeChecks: none, passing, pending", () => {
		expect(summarizeChecks(undefined).state).toBe("none");
		expect(summarizeChecks([]).state).toBe("none");
		expect(
			summarizeChecks([
				{ status: "COMPLETED", conclusion: "SUCCESS" },
				{ status: "COMPLETED", conclusion: "SKIPPED" },
			]),
		).toMatchObject({ state: "passing", passed: 1, skipped: 1 });
		expect(summarizeChecks([{ state: "PENDING" }]).state).toBe("pending");
	});

	test("open_pr: pushes, then creates with the body on stdin", async () => {
		const { call } = await setup([
			{
				tool: "gh",
				args: ["pr", "view"],
				stderr: "no pull requests found",
				code: 1,
			},
			{
				tool: "gh",
				args: ["pr", "create"],
				stdout: "Creating pull request\nhttps://github.com/o/r/pull/42\n",
			},
		]);
		const body = "## Summary\n\n- `$(echo hi)`";
		expect(
			await call("github_open_pr", {
				title: "--draft feat: x",
				body,
				base: "main",
				draft: true,
			}),
		).toEqual({
			url: "https://github.com/o/r/pull/42",
			number: 42,
			created: true,
		});
		const log = await readLog();
		expect(log.map((e) => [e.tool, ...e.argv])).toEqual([
			["git", "push", "-u", "origin", "HEAD"],
			["gh", "pr", "view", "--json", "number,url,state"],
			[
				"gh",
				"pr",
				"create",
				"--title=--draft feat: x",
				"--body-file",
				"-",
				"--base=main",
				"--draft",
			],
		]);
		expect(log[2]?.stdin).toBe(body);
	});

	test("open_pr: returns the open pull request of the branch instead", async () => {
		const { call } = await setup([
			{
				tool: "gh",
				args: ["pr", "view"],
				stdout: JSON.stringify({
					number: 5,
					url: "https://github.com/o/r/pull/5",
					state: "OPEN",
				}),
			},
		]);
		expect(await call("github_open_pr", { title: "T", body: "B" })).toEqual({
			url: "https://github.com/o/r/pull/5",
			number: 5,
			created: false,
		});
		const log = await readLog();
		expect(log.map((e) => e.argv[1])).toEqual(["-u", "view"]);
		expect(log.some((e) => e.argv[1] === "create")).toBe(false);
	});

	test("open_pr: a merged pull request does not count", async () => {
		const { call } = await setup([
			{
				tool: "gh",
				args: ["pr", "view"],
				stdout: JSON.stringify({ number: 5, url: "u", state: "MERGED" }),
			},
			{
				tool: "gh",
				args: ["pr", "create"],
				stdout: "https://github.com/o/r/pull/6\n",
			},
		]);
		expect(
			await call("github_open_pr", { title: "T", body: "B" }),
		).toMatchObject({
			number: 6,
			created: true,
		});
	});

	test("open_pr: a failed push is a tool error and opens nothing", async () => {
		const { call } = await setup([
			{
				tool: "git",
				args: ["push"],
				stderr: "fatal: could not read from remote repository\n",
				code: 128,
			},
		]);
		await expect(
			call("github_open_pr", { title: "T", body: "B" }),
		).rejects.toThrow(
			"git push failed (exit 128): fatal: could not read from remote repository",
		);
		expect((await readLog()).map((e) => e.tool)).toEqual(["git"]);
	});
});

/**
 * The engine's journal in memory: a result per action and key. `started`:
 * every key looks started by an earlier session that never recorded a result.
 */
function memoryJournal(options: { started?: boolean } = {}): EffectJournal {
	const done = new Map<string, unknown>();
	return {
		async once({ action, key, act, find }) {
			const id = `${action}/${key}`;
			if (done.has(id)) {
				return { result: done.get(id) as never, earlier: true };
			}
			if (options.started) {
				const found = await find?.();
				if (found != null) {
					done.set(id, found);
					return { result: found, earlier: true };
				}
			}
			const result = await act();
			done.set(id, result);
			return { result, earlier: false };
		},
	};
}
