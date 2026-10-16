/**
 * The GitHub tools: TanStack AI tools on top of the `gh` CLI.
 *
 * Every tool runs `gh` (or `git`) in the session's worktree, so `gh` finds
 * the repo from the worktree's git remote. Arguments go to the process as an
 * argv array, never through a shell, and every free text (a comment, a pull
 * request body) goes in on stdin with `--body-file -`. No text from an agent
 * can become a shell command or a flag.
 *
 * The Claude Code adapter bridges the tools into a session over MCP, so the
 * agent sees `mcp__tanstack__github_read_issue` and so on. The harness adds
 * those names to `--allowedTools` (see `claude-code.ts`).
 *
 * A failed command throws. The bridge then returns a tool error to the agent
 * with `gh`'s stderr in it, and the agent can try again.
 *
 * A session that continues a step (after a daemon restart or a wait) may
 * call a tool again. `github_comment` goes through the step's effect journal,
 * so the same comment is posted once. The others are safe to repeat:
 * `github_open_pr` returns the open pull request of the branch, a push of the
 * same commits changes nothing, and labels end up the same.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { toolDefinition } from "@tanstack/ai";
import { BRIDGED_MCP_SERVER_NAME } from "@tanstack/ai-claude-code";
import { z } from "zod";

import type { EffectJournal } from "./types";

export const GITHUB_TOOL_NAMES = [
	"github_read_issue",
	"github_list_issues",
	"github_comment",
	"github_set_labels",
	"github_read_pr",
	"github_open_pr",
] as const;

export type GithubToolName = (typeof GITHUB_TOOL_NAMES)[number];

/** The tool names as Claude Code sees them, for `--allowedTools`. */
export const GITHUB_TOOL_IDS: readonly string[] = GITHUB_TOOL_NAMES.map(
	(name) => `mcp__${BRIDGED_MCP_SERVER_NAME}__${name}`,
);

export type GithubToolsOptions = {
	/** The worktree. `gh` and `git` run here. */
	cwd: string;
	/** Path or name of the `gh` executable. Defaults to `gh`. */
	gh?: string;
	/** Path or name of the `git` executable (for the push). Defaults to `git`. */
	git?: string;
	/** Extra environment variables for `gh` and `git`. */
	env?: Record<string, string>;
	/** The step's effect journal. Without one, every call acts. */
	effects?: EffectJournal;
};

export type ProcessResult = { code: number; stdout: string; stderr: string };

/** Never prompt, never page, never color: the output is for a program. */
const QUIET_ENV: Record<string, string> = {
	GH_PROMPT_DISABLED: "1",
	GH_NO_UPDATE_NOTIFIER: "1",
	GH_SPINNER_DISABLED: "1",
	NO_COLOR: "1",
	CLICOLOR: "0",
	GIT_TERMINAL_PROMPT: "0",
};

/** Run one process without a shell. Resolves with its exit code; rejects only when it cannot start or is aborted. */
export function runProcess(
	command: string,
	args: readonly string[],
	options: {
		cwd: string;
		input?: string;
		env?: Record<string, string>;
		signal?: AbortSignal;
	},
): Promise<ProcessResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, [...args], {
			cwd: options.cwd,
			env: { ...process.env, ...QUIET_ENV, ...options.env },
			stdio: ["pipe", "pipe", "pipe"],
			shell: false,
			...(options.signal ? { signal: options.signal } : {}),
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (error: NodeJS.ErrnoException) => {
			if (error.name === "AbortError") {
				reject(new Error(`${command} was aborted`));
			} else if (error.code === "ENOENT") {
				reject(new Error(`${command} not found. Is it installed and on PATH?`));
			} else {
				reject(error);
			}
		});
		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
		// A process that exits before reading stdin makes the write fail: ignore it.
		child.stdin.on("error", () => {});
		child.stdin.end(options.input ?? "");
	});
}

function failure(label: string, result: ProcessResult): Error {
	const detail = result.stderr.trim() || result.stdout.trim() || "no output";
	return new Error(`${label} failed (exit ${result.code}): ${detail}`);
}

type Runner = {
	/** Run `gh` and return its stdout. Throws with stderr on a non-zero exit. */
	gh(args: string[], input?: string, signal?: AbortSignal): Promise<string>;
	/** Run `gh` and return the whole result, for exits that are not errors. */
	ghResult(args: string[], signal?: AbortSignal): Promise<ProcessResult>;
	git(args: string[], signal?: AbortSignal): Promise<string>;
};

function runner(options: GithubToolsOptions): Runner {
	const gh = options.gh ?? "gh";
	const git = options.git ?? "git";
	const base = (signal?: AbortSignal, input?: string) => ({
		cwd: options.cwd,
		...(options.env ? { env: options.env } : {}),
		...(signal ? { signal } : {}),
		...(input !== undefined ? { input } : {}),
	});
	return {
		async gh(args, input, signal) {
			const result = await runProcess(gh, args, base(signal, input));
			if (result.code !== 0) {
				throw failure(`gh ${args.slice(0, 2).join(" ")}`, result);
			}
			return result.stdout;
		},
		ghResult: (args, signal) => runProcess(gh, args, base(signal)),
		async git(args, signal) {
			const result = await runProcess(git, args, base(signal));
			if (result.code !== 0) {
				throw failure(`git ${args.slice(0, 1).join(" ")}`, result);
			}
			return result.stdout;
		},
	};
}

function parseJson(text: string, label: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(
			`${label} returned output that is not JSON: ${text.slice(0, 200)}`,
		);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function labelNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((label) =>
		isRecord(label) && typeof label.name === "string" ? [label.name] : [],
	);
}

export type CheckState = "pass" | "fail" | "pending" | "skipped";

export type ChecksSummary = {
	/** `none` when the pull request has no checks. */
	state: "passing" | "failing" | "pending" | "none";
	total: number;
	passed: number;
	failed: number;
	pending: number;
	skipped: number;
	/** Names of the failed checks. */
	failing: string[];
};

/** One entry of `statusCheckRollup`: a check run or a commit status. */
export function checkState(entry: unknown): CheckState {
	if (!isRecord(entry)) return "pending";
	if (entry.__typename === "StatusContext" || "state" in entry) {
		switch (str(entry.state)) {
			case "SUCCESS":
				return "pass";
			case "FAILURE":
			case "ERROR":
				return "fail";
			default:
				return "pending";
		}
	}
	if (str(entry.status) !== "COMPLETED") return "pending";
	switch (str(entry.conclusion)) {
		case "SUCCESS":
			return "pass";
		case "NEUTRAL":
		case "SKIPPED":
			return "skipped";
		default:
			return "fail";
	}
}

export function summarizeChecks(rollup: unknown): ChecksSummary {
	const entries = Array.isArray(rollup) ? rollup : [];
	const summary: ChecksSummary = {
		state: "none",
		total: entries.length,
		passed: 0,
		failed: 0,
		pending: 0,
		skipped: 0,
		failing: [],
	};
	for (const entry of entries) {
		const state = checkState(entry);
		if (state === "pass") summary.passed++;
		else if (state === "skipped") summary.skipped++;
		else if (state === "pending") summary.pending++;
		else {
			summary.failed++;
			const name = isRecord(entry)
				? (str(entry.name) ?? str(entry.context))
				: undefined;
			summary.failing.push(name ?? "unnamed check");
		}
	}
	if (summary.failed > 0) summary.state = "failing";
	else if (summary.pending > 0) summary.state = "pending";
	else if (entries.length > 0) summary.state = "passing";
	return summary;
}

const number = z
	.number()
	.int()
	.positive()
	.describe("The issue or pull request number.");

/** gh splits label lists on commas, so a label name may not hold one. */
const labelName = z
	.string()
	.min(1)
	.regex(/^[^,]+$/, "A label name cannot contain a comma.");

/**
 * A `.server()` tool whose input is checked against its zod schema. The
 * bridge passes the agent's raw arguments, so the check happens here.
 */
function githubTool<S extends z.ZodType>(
	name: GithubToolName,
	description: string,
	schema: S,
	run: (args: z.output<S>, signal: AbortSignal | undefined) => Promise<unknown>,
) {
	return toolDefinition({ name, description, inputSchema: schema }).server(
		async (raw: unknown, context?: { abortSignal?: AbortSignal }) => {
			const parsed = schema.safeParse(raw);
			if (!parsed.success) {
				throw new Error(`Invalid input: ${z.prettifyError(parsed.error)}`);
			}
			return run(parsed.data, context?.abortSignal);
		},
	);
}

const readIssueInput = z.object({ number });

const listIssuesInput = z.object({
	state: z
		.enum(["open", "closed", "all"])
		.default("open")
		.describe("Which issues to list. Default open."),
	label: labelName.optional().describe("Only issues with this label."),
	limit: z
		.number()
		.int()
		.min(1)
		.max(100)
		.default(30)
		.describe("At most this many issues. Default 30."),
});

const commentInput = z.object({
	number,
	body: z.string().min(1).describe("The comment, in GitHub Markdown."),
});

const setLabelsInput = z
	.object({
		number,
		add: z.array(labelName).default([]).describe("Labels to add."),
		remove: z.array(labelName).default([]).describe("Labels to remove."),
	})
	.refine((input) => input.add.length + input.remove.length > 0, {
		message: "Give at least one label to add or remove.",
	});

const readPrInput = z.object({ number });

const openPrInput = z.object({
	title: z.string().min(1).describe("The pull request title."),
	body: z
		.string()
		.describe("The pull request description, in GitHub Markdown."),
	base: z
		.string()
		.min(1)
		.optional()
		.describe(
			"The branch to merge into. Default: the repository's default branch.",
		),
	draft: z.boolean().optional().describe("Open the pull request as a draft."),
});

const ISSUE_FIELDS = "number,title,body,state,labels,comments,url";
const ISSUE_LIST_FIELDS = "number,title,state,labels,url";
const PR_FIELDS =
	"number,title,body,state,isDraft,url,headRefName,baseRefName,reviewDecision,statusCheckRollup";

/** The GitHub tools, bound to one worktree. */
export function githubTools(options: GithubToolsOptions) {
	const run = runner(options);

	return [
		githubTool(
			"github_read_issue",
			"Read one GitHub issue of this repository: title, body, state, labels, and comments.",
			readIssueInput,
			async ({ number }, signal) => {
				const out = await run.gh(
					["issue", "view", String(number), "--json", ISSUE_FIELDS],
					undefined,
					signal,
				);
				const issue = parseJson(out, "gh issue view");
				if (!isRecord(issue))
					throw new Error("gh issue view returned no issue");
				const comments = Array.isArray(issue.comments) ? issue.comments : [];
				return {
					number: issue.number,
					title: issue.title,
					state: issue.state,
					url: issue.url,
					labels: labelNames(issue.labels),
					body: issue.body,
					comments: comments.filter(isRecord).map((comment) => ({
						author: isRecord(comment.author) ? comment.author.login : undefined,
						createdAt: comment.createdAt,
						body: comment.body,
					})),
				};
			},
		),
		githubTool(
			"github_list_issues",
			"List GitHub issues of this repository, optionally filtered by state and label.",
			listIssuesInput,
			async ({ state, label, limit }, signal) => {
				const out = await run.gh(
					[
						"issue",
						"list",
						`--state=${state}`,
						`--limit=${limit}`,
						...(label !== undefined ? [`--label=${label}`] : []),
						"--json",
						ISSUE_LIST_FIELDS,
					],
					undefined,
					signal,
				);
				const issues = parseJson(out, "gh issue list");
				return (Array.isArray(issues) ? issues : [])
					.filter(isRecord)
					.map((issue) => ({
						number: issue.number,
						title: issue.title,
						state: issue.state,
						url: issue.url,
						labels: labelNames(issue.labels),
					}));
			},
		),
		githubTool(
			"github_comment",
			"Post a comment on a GitHub issue or pull request of this repository. The same comment is posted once per step: a repeat returns the first one.",
			commentInput,
			async ({ number, body }, signal) => {
				const post = async () => {
					const out = await run.gh(
						["issue", "comment", String(number), "--body-file", "-"],
						body,
						signal,
					);
					return { number, url: out.trim() };
				};
				if (!options.effects) return post();
				const { result, earlier } = await options.effects.once({
					action: "github_comment",
					key: `${number}:${sha256(body)}`,
					act: post,
					find: async () => {
						const url = await findComment(run, number, body, signal);
						return url === null ? null : { number, url };
					},
				});
				return earlier ? { ...result, alreadyPosted: true } : result;
			},
		),
		githubTool(
			"github_set_labels",
			"Add and/or remove labels on a GitHub issue or pull request of this repository. The labels must exist.",
			setLabelsInput,
			async ({ number, add, remove }, signal) => {
				await run.gh(
					[
						"issue",
						"edit",
						String(number),
						...(add.length > 0 ? [`--add-label=${add.join(",")}`] : []),
						...(remove.length > 0
							? [`--remove-label=${remove.join(",")}`]
							: []),
					],
					undefined,
					signal,
				);
				return { number, added: add, removed: remove };
			},
		),
		githubTool(
			"github_read_pr",
			"Read one GitHub pull request of this repository: title, body, state, a summary of its checks, and its review decision.",
			readPrInput,
			async ({ number }, signal) => {
				const out = await run.gh(
					["pr", "view", String(number), "--json", PR_FIELDS],
					undefined,
					signal,
				);
				const pr = parseJson(out, "gh pr view");
				if (!isRecord(pr))
					throw new Error("gh pr view returned no pull request");
				return {
					number: pr.number,
					title: pr.title,
					state: pr.state,
					isDraft: pr.isDraft,
					url: pr.url,
					head: pr.headRefName,
					base: pr.baseRefName,
					/** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or null. */
					reviewDecision: str(pr.reviewDecision) || null,
					checks: summarizeChecks(pr.statusCheckRollup),
					body: pr.body,
				};
			},
		),
		githubTool(
			"github_open_pr",
			"Push the current branch and open a GitHub pull request for it. When the branch already has an open pull request, returns that one instead. Returns the URL.",
			openPrInput,
			async ({ title, body, base, draft }, signal) => {
				await run.git(["push", "-u", "origin", "HEAD"], signal);
				// No number: the pull request of the current branch, if any.
				const existing = await run.ghResult(
					["pr", "view", "--json", "number,url,state"],
					signal,
				);
				if (existing.code === 0) {
					const pr = parseJson(existing.stdout, "gh pr view");
					if (isRecord(pr) && pr.state === "OPEN" && str(pr.url)) {
						return { url: pr.url, number: pr.number, created: false };
					}
				}
				const out = await run.gh(
					[
						"pr",
						"create",
						`--title=${title}`,
						"--body-file",
						"-",
						...(base !== undefined ? [`--base=${base}`] : []),
						...(draft ? ["--draft"] : []),
					],
					body,
					signal,
				);
				const url = out.trim().split(/\r?\n/).at(-1) ?? "";
				const match = /\/pull\/(\d+)/.exec(url);
				return {
					url,
					...(match?.[1] ? { number: Number(match[1]) } : {}),
					created: true,
				};
			},
		),
	];
}

export type GithubTool = ReturnType<typeof githubTools>[number];

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/**
 * The URL of the latest comment on the issue or pull request with exactly
 * this body, or null. One line per comment: `[url, body]` as JSON.
 */
async function findComment(
	run: Runner,
	number: number,
	body: string,
	signal: AbortSignal | undefined,
): Promise<string | null> {
	const out = await run.gh(
		[
			"api",
			`repos/{owner}/{repo}/issues/${number}/comments`,
			"--paginate",
			"--jq",
			".[] | [.html_url, .body] | @json",
		],
		undefined,
		signal,
	);
	let found: string | null = null;
	for (const line of out.split("\n")) {
		if (line.trim() === "") continue;
		const entry = parseJson(line, "gh api");
		if (Array.isArray(entry) && entry[1] === body && str(entry[0])) {
			found = entry[0];
		}
	}
	return found;
}
