import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeBin } from "./fixtures/bin";
import { readGithubItems, SUB_ISSUES_QUERY } from "./github-items";
import type { GithubItemsInput } from "./types";

type LogEntry = { argv: string[]; cwd: string; pid: number };
type Rule = {
	tool: "gh";
	args: string[];
	stdout?: string;
	stderr?: string;
	code?: number;
	sleepMs?: number;
};

let dir: string;
let cwd: string;
let logFile: string;
let rulesFile: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-items-"));
	cwd = await mkdtemp(join(tmpdir(), "nightshift-items-cwd-"));
	logFile = join(dir, "log.jsonl");
	rulesFile = join(dir, "rules.json");
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
	await rm(cwd, { recursive: true, force: true });
});

const REPO_VIEW: Rule = {
	tool: "gh",
	args: ["repo", "view", "--json", "owner,name"],
	stdout: JSON.stringify({ owner: { id: "O_1", login: "acme" }, name: "game" }),
};

/** The argv prefix of one GraphQL page, up to and including its cursor. */
function pageArgs(parent: number, cursor?: string): string[] {
	return [
		"api",
		"graphql",
		"-F",
		`number=${parent}`,
		"-f",
		"owner=acme",
		"-f",
		"name=game",
		...(cursor === undefined ? [] : ["-f", `cursor=${cursor}`]),
	];
}

type Node = {
	number: number;
	title?: string;
	body?: string | null;
	state?: "OPEN" | "CLOSED";
	labels?: string[];
	blockedBy?: [number, "OPEN" | "CLOSED"][];
};

function page(
	nodes: Node[],
	next?: string,
	parent = { number: 10, title: "Feature: combat" },
): string {
	return JSON.stringify({
		data: {
			repository: {
				issue: {
					...parent,
					subIssues: {
						pageInfo: {
							hasNextPage: next !== undefined,
							endCursor: next ?? null,
						},
						nodes: nodes.map((n) => ({
							number: n.number,
							title: n.title ?? `Trace ${n.number}`,
							body: n.body === undefined ? `Body of ${n.number}` : n.body,
							state: n.state ?? "OPEN",
							url: `https://github.com/acme/game/issues/${n.number}`,
							labels: { nodes: (n.labels ?? []).map((name) => ({ name })) },
							blockedBy: {
								nodes: (n.blockedBy ?? []).map(([number, state]) => ({
									number,
									state,
								})),
							},
						})),
					},
				},
			},
		},
	});
}

async function setup(rules: Rule[]) {
	await writeFile(rulesFile, JSON.stringify(rules));
	return fakeBin(dir, "gh", "fake-gh", {
		FAKE_LOG: logFile,
		FAKE_RULES: rulesFile,
		FAKE_TOOL: "gh",
	});
}

async function readLog(): Promise<LogEntry[]> {
	try {
		return (await readFile(logFile, "utf8"))
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	} catch {
		return [];
	}
}

function input(overrides: Partial<GithubItemsInput> = {}): GithubItemsInput {
	return {
		cwd,
		parent: 10,
		doneLabels: [],
		signal: new AbortController().signal,
		...overrides,
	};
}

describe("readGithubItems", () => {
	test("maps sub-issues to items, with argv only and the repo from cwd", async () => {
		const gh = await setup([
			REPO_VIEW,
			{
				tool: "gh",
				args: pageArgs(10),
				stdout: page([
					{ number: 11, title: "First", body: "Do the first thing." },
					{
						number: 12,
						title: "Second",
						body: null,
						blockedBy: [
							[11, "OPEN"],
							[3, "CLOSED"],
						],
					},
				]),
			},
		]);
		expect(await readGithubItems(input(), { gh })).toEqual([
			{
				id: "11",
				number: 11,
				title: "First",
				body: "Do the first thing.",
				url: "https://github.com/acme/game/issues/11",
				blockedBy: [],
				done: false,
				parentNumber: 10,
				parentTitle: "Feature: combat",
			},
			{
				id: "12",
				number: 12,
				title: "Second",
				body: "",
				url: "https://github.com/acme/game/issues/12",
				blockedBy: [
					{ id: "11", done: false },
					{ id: "3", done: true },
				],
				done: false,
				parentNumber: 10,
				parentTitle: "Feature: combat",
			},
		]);
		const log = await readLog();
		expect(log.map((entry) => entry.argv)).toEqual([
			["repo", "view", "--json", "owner,name"],
			[...pageArgs(10), "-f", `query=${SUB_ISSUES_QUERY}`],
		]);
		for (const entry of log) {
			expect(entry.cwd).toEndWith(cwd.split("/").at(-1) ?? "");
		}
	});

	test("the query reads sub-issues with blockedBy, body, and pageInfo", () => {
		expect(SUB_ISSUES_QUERY).toContain("subIssues(first: 50, after: $cursor)");
		expect(SUB_ISSUES_QUERY).toContain("pageInfo { hasNextPage endCursor }");
		expect(SUB_ISSUES_QUERY).toContain("blockedBy(first: 50)");
		expect(SUB_ISSUES_QUERY).toMatch(/nodes \{\s+number title body state url/);
		expect(SUB_ISSUES_QUERY).not.toMatch(/mutation/);
	});

	test("pages through all sub-issues with the cursor", async () => {
		const gh = await setup([
			REPO_VIEW,
			{
				tool: "gh",
				args: pageArgs(10, "C2"),
				stdout: page([{ number: 15 }]),
			},
			{
				tool: "gh",
				args: pageArgs(10, "C1"),
				stdout: page([{ number: 13 }, { number: 14 }], "C2"),
			},
			{
				tool: "gh",
				args: pageArgs(10),
				stdout: page([{ number: 11 }, { number: 12 }], "C1"),
			},
		]);
		const items = await readGithubItems(input(), { gh });
		expect(items.map((item) => item.id)).toEqual([
			"11",
			"12",
			"13",
			"14",
			"15",
		]);
		const pages = (await readLog()).filter((e) => e.argv[0] === "api");
		expect(
			pages.map((e) => e.argv.find((a) => a.startsWith("cursor="))),
		).toEqual([undefined, "cursor=C1", "cursor=C2"]);
	});

	test("done: closed, or a done label (any case)", async () => {
		const gh = await setup([
			REPO_VIEW,
			{
				tool: "gh",
				args: pageArgs(10),
				stdout: page([
					{ number: 11, state: "CLOSED" },
					{ number: 12, labels: ["trace", "Shipped"] },
					{ number: 13, labels: ["trace"] },
				]),
			},
		]);
		const items = await readGithubItems(
			input({ doneLabels: ["shipped", "night-shift: done"] }),
			{ gh },
		);
		expect(items.map((item) => [item.id, item.done])).toEqual([
			["11", true],
			["12", true],
			["13", false],
		]);
	});

	test("leaves out sub-issues without requireLabel", async () => {
		const gh = await setup([
			REPO_VIEW,
			{
				tool: "gh",
				args: pageArgs(10),
				stdout: page([
					{ number: 11, labels: ["trace"] },
					{ number: 12, labels: ["bug"] },
					{ number: 13, labels: ["Trace", "ui"] },
					{ number: 14 },
				]),
			},
		]);
		const items = await readGithubItems(input({ requireLabel: "trace" }), {
			gh,
		});
		expect(items.map((item) => item.id)).toEqual(["11", "13"]);
	});

	test("leaves out sub-issues with a skip label", async () => {
		const gh = await setup([
			REPO_VIEW,
			{
				tool: "gh",
				args: pageArgs(10),
				stdout: page([
					{ number: 11, labels: ["trace"] },
					{ number: 12, labels: ["trace", "Draft"] },
				]),
			},
		]);
		const items = await readGithubItems(
			input({ requireLabel: "trace", skipLabels: ["draft"] }),
			{ gh },
		);
		expect(items.map((item) => item.id)).toEqual(["11"]);
	});

	test("no sub-issues: an empty list", async () => {
		const gh = await setup([
			REPO_VIEW,
			{ tool: "gh", args: pageArgs(10), stdout: page([]) },
		]);
		expect(await readGithubItems(input(), { gh })).toEqual([]);
	});

	test("a missing parent issue throws", async () => {
		const gh = await setup([
			REPO_VIEW,
			{
				tool: "gh",
				args: pageArgs(10),
				stdout: JSON.stringify({ data: { repository: { issue: null } } }),
			},
		]);
		await expect(readGithubItems(input(), { gh })).rejects.toThrow(
			"acme/game has no issue #10.",
		);
	});

	test("a failing gh throws with its stderr", async () => {
		const gh = await setup([
			REPO_VIEW,
			{
				tool: "gh",
				args: pageArgs(10),
				code: 1,
				stderr:
					'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host',
			},
		]);
		await expect(readGithubItems(input(), { gh })).rejects.toThrow(
			/no such host/,
		);
	});

	test("a repo view failure throws before any query", async () => {
		const gh = await setup([
			{
				tool: "gh",
				args: ["repo", "view"],
				code: 1,
				stderr: "no git remotes found",
			},
		]);
		await expect(readGithubItems(input(), { gh })).rejects.toThrow(
			/no git remotes found/,
		);
		expect((await readLog()).map((e) => e.argv[0])).toEqual(["repo"]);
	});

	test("an aborted signal never starts gh", async () => {
		const gh = await setup([REPO_VIEW]);
		const controller = new AbortController();
		controller.abort();
		await expect(
			readGithubItems(input({ signal: controller.signal }), { gh }),
		).rejects.toThrow(/aborted/);
		expect(await readLog()).toEqual([]);
	});

	test("aborting kills gh", async () => {
		const gh = await setup([
			REPO_VIEW,
			{ tool: "gh", args: pageArgs(10), sleepMs: 20_000, stdout: page([]) },
		]);
		const controller = new AbortController();
		const started = Date.now();
		const reading = readGithubItems(input({ signal: controller.signal }), {
			gh,
		});
		// Abort once the query is running.
		for (let i = 0; i < 100; i++) {
			if ((await readLog()).some((e) => e.argv[0] === "api")) break;
			await Bun.sleep(50);
		}
		controller.abort();
		await expect(reading).rejects.toThrow(/aborted/);
		expect(Date.now() - started).toBeLessThan(10_000);
		const query = (await readLog()).find((e) => e.argv[0] === "api");
		expect(query).toBeDefined();
		await Bun.sleep(100);
		expect(() => process.kill(query?.pid ?? 0, 0)).toThrow();
	});
});
