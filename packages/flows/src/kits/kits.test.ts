import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Flow } from "../flow";
import {
	type CommandNode,
	commandWaitOutcome,
	dataExitFor,
	exitFor,
	type JsonValue,
	type WaitNode,
	waitCommandOf,
} from "../nodes";
import { chooseByRule, renderCommand, runFields } from "../template";
import {
	isKitName,
	kitCopyName,
	kitFlow,
	kitList,
	knowledgeKitsOf,
} from "./kits";

/**
 * The kits' commands, run as a Command step runs them: `sh -c` in a real
 * git repository with an `origin`, templates as environment variables and
 * a fresh `$NS_OUTPUT`. `gh` and `acli` are stubs on PATH that log their
 * arguments and answer from fixture files.
 */

let root: string;
/** The repository a step runs in, with `main` pushed to `origin`. */
let repo: string;
/** The bare repository behind `origin`. */
let origin: string;
/** The stubs' folder, first on PATH. */
let bin: string;
/** What `gh <a> <b>` answers: `<a>-<b>.json`, else nothing, and `<a>-<b>.exit`. */
let fixtures: string;
let log: string;
/** The project's knowledge folder, in `$NS_KNOWLEDGE`. */
let knowledge: string;

const GIT_ENV = {
	GIT_AUTHOR_NAME: "Night Shift",
	GIT_AUTHOR_EMAIL: "night@shift.test",
	GIT_COMMITTER_NAME: "Night Shift",
	GIT_COMMITTER_EMAIL: "night@shift.test",
};

/**
 * A stub of `gh` or `acli`: logs one line of arguments, prints the
 * fixture of its first two arguments (through `jq -rc` with `--jq`, as gh
 * prints strings raw) and exits with the fixture's code.
 */
const STUB = `#!/bin/sh
printf '%s\\n' "$(basename "$0") $*" >> "$STUB_LOG"
key="$1-$2"
[ "$1" = api ] && key=api
filter=""
prev=""
for arg in "$@"; do
	[ "$prev" = --jq ] && filter="$arg"
	prev="$arg"
done
fixture="$STUB_FIXTURES/$key.json"
if [ -f "$fixture" ]; then
	if [ -n "$filter" ]; then jq -rc "$filter" "$fixture"; else cat "$fixture"; fi
fi
code=0
[ -f "$STUB_FIXTURES/$key.exit" ] && code=$(cat "$STUB_FIXTURES/$key.exit")
exit "$code"
`;

/**
 * A stub of `curl`: logs one line of arguments, with the value of
 * `CONFLUENCE_API_TOKEN` as it got it, and prints `curl.out`.
 */
const CURL_STUB = `#!/bin/sh
printf '%s\\n' "curl $*" >> "$STUB_LOG"
cat "$STUB_FIXTURES/curl.out"
`;

async function sh(cwd: string, command: string): Promise<string> {
	const proc = Bun.spawn(["sh", "-c", command], {
		cwd,
		env: { ...process.env, ...GIT_ENV },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) throw new Error(`${command}: ${err}`);
	return out.trim();
}

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "nightshift-kits-")));
	repo = join(root, "repo");
	origin = join(root, "origin.git");
	bin = join(root, "bin");
	fixtures = join(root, "fixtures");
	log = join(root, "stub.log");
	knowledge = join(root, "knowledge");
	await mkdir(repo);
	await mkdir(bin);
	await mkdir(fixtures);
	await writeFile(log, "");
	for (const name of ["gh", "acli", "acli-dimpact"]) {
		await writeFile(join(bin, name), STUB);
		await chmod(join(bin, name), 0o755);
	}
	await writeFile(join(bin, "curl"), CURL_STUB);
	await chmod(join(bin, "curl"), 0o755);
	await sh(root, `git init -q --bare -b main "${origin}"`);
	await sh(
		repo,
		`git init -q -b main && echo one > a.txt && git add a.txt && git commit -qm one && git remote add origin "${origin}" && git push -q origin main`,
	);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function fixture(key: string, json: unknown, exit = 0): Promise<void> {
	await writeFile(join(fixtures, `${key}.json`), JSON.stringify(json));
	if (exit !== 0) await writeFile(join(fixtures, `${key}.exit`), String(exit));
}

/** The lines the stubs logged. */
async function calls(): Promise<string[]> {
	return (await readFile(log, "utf8")).split("\n").filter(Boolean);
}

function kit(name: string): Flow {
	const flow = kitFlow(name);
	if (!flow) throw new Error(`no kit ${name}`);
	return flow;
}

type Ran = { outcome: string | undefined; data: JsonValue; log: string };

/**
 * Runs one Command node of a kit, or the command a Wait polls, with the
 * kit's input defaults under `inputs`, and earlier steps' outputs as
 * `nodes`. The outcome is the one the engine picks: the data's, else the
 * exit code's. A Wait's poll that does not end the wait is `again`.
 */
async function step(
	flow: Flow,
	nodeId: string,
	inputs: Record<string, string>,
	nodes: Record<string, Record<string, JsonValue>> = {},
	where: { cwd?: string; env?: Record<string, string> } = {},
): Promise<Ran> {
	const node = flow.nodes.find(
		(candidate): candidate is CommandNode | WaitNode =>
			candidate.id === nodeId &&
			(candidate.type === "command" || candidate.type === "wait"),
	);
	const text =
		node?.type === "wait" ? waitCommandOf(node.until)?.command : node?.command;
	if (!node || text === undefined) throw new Error(`no command ${nodeId}`);
	const values: Record<string, JsonValue> = {};
	for (const input of flow.inputs) values[input.name] = input.default ?? "";
	Object.assign(values, inputs);
	const run = Object.fromEntries(runFields.map((field) => [field, ""]));
	const { command, env } = renderCommand(text, {
		nodes,
		inputs: values,
		run: run as Record<(typeof runFields)[number], string>,
	});
	const output = join(root, `${nodeId}.json`);
	await writeFile(output, "");
	const proc = Bun.spawn(["sh", "-c", command], {
		cwd: where.cwd ?? repo,
		env: {
			...process.env,
			...GIT_ENV,
			...where.env,
			...env,
			NS_OUTPUT: output,
			NS_KNOWLEDGE: knowledge,
			PATH: `${bin}:${process.env.PATH}`,
			STUB_LOG: log,
			STUB_FIXTURES: fixtures,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	const written = (await readFile(output, "utf8")).trim();
	const data = written === "" ? null : (JSON.parse(written) as JsonValue);
	if (node.type === "wait") {
		const picked = commandWaitOutcome(node, code, data);
		return {
			outcome: picked.kind === "outcome" ? picked.outcome : "again",
			data,
			log: `${out}${err}`,
		};
	}
	const outcome = (dataExitFor(node, data) ?? exitFor(node, code))?.name;
	return { outcome, data, log: `${out}${err}` };
}

describe("the kit registry", () => {
	test("finds a kit by name, and a copy's file name", () => {
		expect(isKitName("kit:github/create-branch")).toBe(true);
		expect(isKitName("create-branch")).toBe(false);
		expect(kitFlow("kit:github/create-branch")?.start).toBe("create");
		expect(kitFlow("kit:github/nope")).toBeUndefined();
		expect(kitFlow("create-branch")).toBeUndefined();
		expect(kitCopyName("kit:github/publish-draft-pr")).toBe(
			"github-publish-draft-pr",
		);
		expect(kitCopyName("github")).toBeNull();
		expect(kitList().length).toBeGreaterThan(0);
	});

	test("finds the knowledge kits a flow calls", () => {
		const call = (id: string, flow: string) => ({
			id,
			type: "call" as const,
			position: { x: 0, y: 0 },
			flow,
			inputs: {},
		});
		const flow = {
			...kit("kit:jira/move"),
			nodes: [
				call("a", "kit:knowledge/web"),
				call("b", "kit:github/finish-pr"),
				call("c", "kit:knowledge/files"),
				call("d", "kit:knowledge/web"),
			],
		} as Flow;
		expect(knowledgeKitsOf(flow)).toEqual([
			"kit:knowledge/files",
			"kit:knowledge/web",
		]);
		expect(knowledgeKitsOf(kit("kit:jira/move"))).toEqual([]);
	});
});

describe("kit:github/create-branch", () => {
	const flow = () => kit("kit:github/create-branch");

	test("switches to a new branch at the current commit", async () => {
		const head = await sh(repo, "git rev-parse HEAD");
		const ran = await step(flow(), "create", { name: "feature/1-login" });
		expect(ran.outcome).toBe("created");
		expect(ran.data).toEqual({
			branch: "feature/1-login",
			created: true,
			sha: head,
		});
		expect(await sh(repo, "git branch --show-current")).toBe("feature/1-login");
	});

	test("starts from a branch on GitHub", async () => {
		const pushed = await sh(repo, "git rev-parse HEAD");
		await sh(repo, "echo two > b.txt && git add b.txt && git commit -qm two");
		const ran = await step(flow(), "create", {
			name: "fresh",
			from: "main",
		});
		expect(ran.outcome).toBe("created");
		expect(await sh(repo, "git rev-parse HEAD")).toBe(pushed);
		expect(await sh(repo, "git branch --show-current")).toBe("fresh");
	});

	test("switches to a branch that exists as it is", async () => {
		await sh(repo, "git branch old && echo x > c.txt");
		const ran = await step(flow(), "create", { name: "old" });
		expect(ran.outcome).toBe("created");
		expect(ran.data).toMatchObject({ branch: "old", created: false });
		expect(await sh(repo, "git branch --show-current")).toBe("old");
	});

	test("refuses a name that is not a branch name", async () => {
		const ran = await step(flow(), "create", { name: "two words" });
		expect(ran.outcome).toBe("invalid-name");
		expect(await sh(repo, "git branch --show-current")).toBe("main");
	});

	test("fails on a base that GitHub does not have", async () => {
		const ran = await step(flow(), "create", { name: "x", from: "nope" });
		expect(ran.outcome).toBe("fail");
	});
});

describe("kit:github/publish-draft-pr", () => {
	const flow = () => kit("kit:github/publish-draft-pr");

	test("a branch without new commits has nothing to publish", async () => {
		await sh(repo, "git switch -qc empty");
		const ran = await step(flow(), "push", { title: "T", base: "main" });
		expect(ran.outcome).toBe("no-commits");
		expect(ran.data).toEqual({
			outcome: "no-commits",
			branch: "empty",
			base: "main",
		});
		expect(await calls()).toEqual([]);
	});

	test("pushes the branch, then opens a draft pull request", async () => {
		await sh(
			repo,
			"git switch -qc feature && echo two > b.txt && git add b.txt && git commit -qm two",
		);
		await fixture("repo-view", { defaultBranchRef: { name: "main" } });
		const pushed = await step(flow(), "push", { title: "T" });
		expect(pushed.outcome).toBe("pushed");
		expect(pushed.data).toEqual({ branch: "feature", base: "main", ahead: 1 });
		expect(await sh(origin, "git rev-parse feature")).toBe(
			await sh(repo, "git rev-parse HEAD"),
		);

		await fixture("pr-list", []);
		await fixture("pr-view", {
			number: 7,
			url: "https://github.com/acme/app/pull/7",
		});
		const opened = await step(
			flow(),
			"open",
			{ title: 'Fix "it"', body: "Line one\nLine two" },
			{ push: { data: pushed.data } },
		);
		expect(opened.outcome).toBe("open");
		expect(opened.data).toEqual({
			number: 7,
			url: "https://github.com/acme/app/pull/7",
			created: true,
		});
		const log = await calls();
		expect(log[0]).toBe(
			"gh repo view --json defaultBranchRef --jq .defaultBranchRef.name",
		);
		// The body's second line is a log line of its own.
		expect(log).toContain(
			'gh pr create --draft --head feature --base main --title Fix "it" --body Line one',
		);
	});

	test("a base that GitHub does not have becomes the default branch", async () => {
		await sh(
			repo,
			"git switch -qc feature && echo two > b.txt && git add b.txt && git commit -qm two",
		);
		await fixture("repo-view", { defaultBranchRef: { name: "main" } });
		const pushed = await step(flow(), "push", {
			title: "T",
			base: "nightshift/run-1",
		});
		expect(pushed.data).toMatchObject({ base: "main" });
	});

	test("keeps the pull request that is open for the branch", async () => {
		await fixture("pr-list", [
			{ number: 3, url: "https://github.com/acme/app/pull/3" },
		]);
		const opened = await step(
			flow(),
			"open",
			{ title: "T" },
			{ push: { data: { branch: "feature", base: "main" } } },
		);
		expect(opened.outcome).toBe("open");
		expect(opened.data).toEqual({
			number: 3,
			url: "https://github.com/acme/app/pull/3",
			created: false,
		});
		expect((await calls()).some((line) => line.includes("pr create"))).toBe(
			false,
		);
	});

	test("fails when GitHub refuses the pull request", async () => {
		await fixture("pr-list", []);
		await fixture("pr-create", "", 1);
		const opened = await step(
			flow(),
			"open",
			{ title: "T" },
			{ push: { data: { branch: "feature", base: "main" } } },
		);
		expect(opened.outcome).toBe("fail");
	});
});

describe("kit:github/finish-pr", () => {
	const flow = () => kit("kit:github/finish-pr");
	const view = {
		number: 7,
		url: "https://github.com/acme/app/pull/7",
		state: "OPEN",
		isDraft: false,
	};

	test("the action picks ready, close, or neither", async () => {
		const what = flow().nodes.find((node) => node.id === "what");
		if (what?.type !== "decision") throw new Error("no decision");
		const pick = async (action: string) =>
			(
				await chooseByRule(what.options, {
					nodes: {},
					inputs: { pr: "7", action, comment: "" },
					run: Object.fromEntries(runFields.map((f) => [f, ""])) as never,
				})
			).matched;
		expect(await pick("ready")).toBe("ready");
		expect(await pick("close")).toBe("close");
		expect(await pick("merge")).toBe("other");
	});

	test("marks it ready, then leaves the comment", async () => {
		await fixture("pr-view", view);
		const ran = await step(flow(), "ready", { pr: "7", comment: "Done." });
		expect(ran.outcome).toBe("ready");
		expect(ran.data).toEqual({
			number: 7,
			url: "https://github.com/acme/app/pull/7",
			state: "open",
			draft: false,
		});
		expect((await calls()).slice(0, 2)).toEqual([
			"gh pr ready 7",
			"gh pr comment 7 --body Done.",
		]);
	});

	test("closes it with the comment", async () => {
		await fixture("pr-view", { ...view, state: "CLOSED" });
		const ran = await step(flow(), "close", {
			pr: "7",
			action: "close",
			comment: "Not needed.",
		});
		expect(ran.outcome).toBe("closed");
		expect(ran.data).toMatchObject({ state: "closed" });
		expect((await calls())[0]).toBe("gh pr close 7 --comment Not needed.");
	});

	test("closes it without a comment", async () => {
		await fixture("pr-view", { ...view, state: "CLOSED" });
		await step(flow(), "close", { pr: "7", action: "close" });
		expect((await calls())[0]).toBe("gh pr close 7");
	});

	test("fails when gh does", async () => {
		await fixture("pr-ready", "", 1);
		const ran = await step(flow(), "ready", { pr: "7" });
		expect(ran.outcome).toBe("fail");
	});
});

describe("kit:github/wait-for-checks", () => {
	const flow = () => kit("kit:github/wait-for-checks");
	const run = (name: string, status: string, conclusion: string | null) => ({
		name,
		status,
		conclusion,
	});

	test("checks that all passed pass", async () => {
		const head = await sh(repo, "git rev-parse HEAD");
		await fixture("api", {
			check_runs: [
				run("build", "completed", "success"),
				run("lint", "completed", "skipped"),
			],
		});
		const ran = await step(flow(), "look", {});
		expect(ran.outcome).toBe("passed");
		expect(ran.data).toEqual({
			sha: head,
			outcome: "passed",
			total: 2,
			pending: [],
			failed: [],
			failed_names: "",
		});
		expect((await calls())[0]).toStartWith(
			`gh api repos/{owner}/{repo}/commits/${head}/check-runs?per_page=100 --jq `,
		);
	});

	test("a check that failed fails, and names it", async () => {
		await fixture("api", {
			check_runs: [
				run("build", "completed", "failure"),
				run("test", "completed", "timed_out"),
				run("lint", "completed", "success"),
			],
		});
		const ran = await step(flow(), "look", {});
		expect(ran.outcome).toBe("failing");
		expect(ran.data).toMatchObject({
			failed: ["build", "test"],
			failed_names: "build, test",
		});
	});

	test("a check that runs, or no check yet, is pending", async () => {
		await fixture("api", {
			check_runs: [
				run("build", "in_progress", null),
				run("lint", "completed", "failure"),
			],
		});
		expect((await step(flow(), "look", {})).outcome).toBe("pending");
		await fixture("api", { check_runs: [] });
		expect((await step(flow(), "look", {})).outcome).toBe("pending");
	});

	test("reads the commit it is given, a sha as it is", async () => {
		await fixture("api", { check_runs: [] });
		const sha = "a".repeat(40);
		const ran = await step(flow(), "look", { ref: sha });
		expect(ran.data).toMatchObject({ sha });
		const branch = await step(flow(), "look", { ref: "main" });
		expect(branch.data).toMatchObject({
			sha: await sh(repo, "git rev-parse main"),
		});
	});

	test("fails when GitHub does not answer", async () => {
		await fixture("api", {}, 1);
		expect((await step(flow(), "look", {})).outcome).toBe("fail");
	});

	test("waits for ci-done with the commit as its key", () => {
		const wait = flow().nodes.find((node) => node.id === "wait");
		expect(wait).toMatchObject({
			type: "wait",
			until: { kind: "signal", name: "ci-done", key: "{{look.data.sha}}" },
		});
	});
});

describe("kit:github/watch-pr", () => {
	const flow = () => kit("kit:github/watch-pr");
	const since = "2026-10-31T10:00:00Z";
	const started = { start: { data: { number: 7, since } } };
	/** A pull request as the GraphQL query answers it. */
	const pr = (fields: {
		state?: string;
		isInMergeQueue?: boolean;
		reviewDecision?: string | null;
		rollup?: string | null;
		checks?: { name: string; conclusion: string | null }[];
		removedAt?: string[];
	}) => ({
		data: {
			repository: {
				pullRequest: {
					number: 7,
					url: "https://github.com/acme/repo/pull/7",
					state: fields.state ?? "OPEN",
					isInMergeQueue: fields.isInMergeQueue ?? false,
					reviewDecision: fields.reviewDecision ?? null,
					headRefOid: "abc123",
					commits: {
						nodes: [
							{
								commit: {
									statusCheckRollup:
										fields.rollup === null
											? null
											: {
													state: fields.rollup ?? "SUCCESS",
													contexts: { nodes: fields.checks ?? [] },
												},
								},
							},
						],
					},
					timelineItems: {
						nodes: (fields.removedAt ?? []).map((createdAt) => ({ createdAt })),
					},
				},
			},
		},
	});
	const watch = async (fields: Parameters<typeof pr>[0]) => {
		await fixture("api", pr(fields));
		return step(flow(), "watch", {}, started);
	};

	test("finds the pull request of the branch, and notes when the watch began", async () => {
		await fixture("pr-view", { number: 7 });
		const ran = await step(flow(), "start", {});
		expect(ran.outcome).toBe("pass");
		expect(ran.data).toMatchObject({ number: 7 });
		expect((await calls())[0]).toBe("gh pr view --json number --jq .number");
		await step(flow(), "start", { pr: "42" });
		expect((await calls())[1]).toBe("gh pr view 42 --json number --jq .number");
	});

	test("checks that all passed, with no review that holds it back, are green", async () => {
		const ran = await watch({
			checks: [{ name: "build", conclusion: "SUCCESS" }],
		});
		expect(ran.outcome).toBe("green");
		expect(ran.data).toEqual({
			outcome: "green",
			number: 7,
			url: "https://github.com/acme/repo/pull/7",
			sha: "abc123",
			review: "",
			failed: [],
			failed_names: "",
		});
		expect((await calls())[0]).toStartWith(
			"gh api graphql -F owner={owner} -F repo={repo} -F number=7 -f query=",
		);
		expect(
			(await watch({ rollup: "SUCCESS", reviewDecision: "APPROVED" })).outcome,
		).toBe("green");
	});

	test("a failed check, or a review that asks for changes, is red", async () => {
		const failed = await watch({
			rollup: "FAILURE",
			checks: [
				{ name: "build", conclusion: "FAILURE" },
				{ name: "lint", conclusion: "SUCCESS" },
				{ name: "test", conclusion: "TIMED_OUT" },
			],
		});
		expect(failed.outcome).toBe("red");
		expect(failed.data).toMatchObject({
			failed: ["build", "test"],
			failed_names: "build, test",
		});
		expect((await watch({ reviewDecision: "CHANGES_REQUESTED" })).outcome).toBe(
			"red",
		);
	});

	test("merged and closed end it, whatever the checks say", async () => {
		expect((await watch({ state: "MERGED", rollup: "FAILURE" })).outcome).toBe(
			"merged",
		);
		expect((await watch({ state: "CLOSED" })).outcome).toBe("closed");
	});

	test("in the merge queue it waits for the queue, and a removal since the watch began is ejected", async () => {
		expect(
			(
				await watch({
					isInMergeQueue: true,
					removedAt: ["2026-10-31T11:00:00Z"],
				})
			).outcome,
		).toBe("again");
		expect((await watch({ removedAt: ["2026-10-31T11:00:00Z"] })).outcome).toBe(
			"ejected",
		);
		expect((await watch({ removedAt: ["2026-10-30T09:00:00Z"] })).outcome).toBe(
			"green",
		);
	});

	test("running checks, no checks yet, or a review that is still required read again later", async () => {
		expect(
			(
				await watch({
					rollup: "PENDING",
					checks: [{ name: "build", conclusion: null }],
				})
			).outcome,
		).toBe("again");
		expect((await watch({ rollup: null })).outcome).toBe("again");
		expect((await watch({ reviewDecision: "REVIEW_REQUIRED" })).outcome).toBe(
			"again",
		);
	});

	test("reads again when GitHub does not answer", async () => {
		await fixture("api", {}, 1);
		expect((await step(flow(), "watch", {}, started)).outcome).toBe("again");
	});

	test("a webhook with the number as its key wakes it, and it waits again to read the pull request", () => {
		const node = flow().nodes.find((candidate) => candidate.id === "watch");
		expect(node).toMatchObject({
			type: "wait",
			until: {
				kind: "any",
				signal: { name: "pr-changed", key: "{{start.data.number}}" },
			},
		});
		expect(
			flow().edges.filter(
				(edge) => edge.from === "watch" && edge.outcome === "done",
			),
		).toMatchObject([{ to: "watch" }, { to: "too_long" }]);
	});
});

describe("kit:jira", () => {
	test("assign assigns the work item to you", async () => {
		const ran = await step(kit("kit:jira/assign"), "assign", {
			key: "PROJ-1",
		});
		expect(ran.outcome).toBe("assigned");
		expect(await calls()).toEqual([
			"acli jira workitem assign --key PROJ-1 --assignee @me --yes",
		]);
	});

	test("move moves the work item, and fails when acli does", async () => {
		const flow = kit("kit:jira/move");
		const ran = await step(flow, "move", {
			key: "PROJ-1",
			status: "In Progress",
		});
		expect(ran.outcome).toBe("moved");
		expect(await calls()).toEqual([
			"acli jira workitem transition --key PROJ-1 --status In Progress --yes",
		]);
		await fixture("jira-workitem", {}, 1);
		expect(
			(await step(flow, "move", { key: "PROJ-1", status: "Done" })).outcome,
		).toBe("fail");
	});

	test("runs the CLI tool it is given, as that tool's account", async () => {
		await step(kit("kit:jira/assign"), "assign", {
			key: "PROJ-1",
			tool: "acli-dimpact",
		});
		await step(kit("kit:jira/move"), "move", {
			key: "PROJ-1",
			status: "Done",
			tool: "acli-dimpact",
		});
		expect(await calls()).toEqual([
			"acli-dimpact jira workitem assign --key PROJ-1 --assignee @me --yes",
			"acli-dimpact jira workitem transition --key PROJ-1 --status Done --yes",
		]);
	});
});

describe("the knowledge kits", () => {
	const read = (path: string) => readFile(join(knowledge, path), "utf8");

	test("every one refuses a folder outside the knowledge, or Night Shift's own", async () => {
		for (const folder of [
			"../out",
			"/tmp/x",
			"learnings/accepted",
			"evals",
			"evals/questions",
			"",
		]) {
			const ran = await step(kit("kit:knowledge/web"), "sync", {
				urls: "https://example.com",
				folder,
			});
			expect(ran.outcome).toBe("fail");
		}
		expect(await calls()).toEqual([]);
	});

	test("files: copies what git ignores from the project's folder, also from the run's copy", async () => {
		await sh(
			repo,
			"mkdir -p docs/private && printf '# Secret plan\\n' > docs/private/plan.md && printf 'n' > notes.md && echo 'docs/private/' > .gitignore",
		);
		const copy = join(root, "copy");
		await sh(repo, `git worktree add -q "${copy}"`);
		const ran = await step(
			kit("kit:knowledge/files"),
			"sync",
			{ from: "docs/private\nnotes.*\nmissing/*" },
			{},
			{ cwd: copy },
		);
		expect(ran.outcome).toBe("synced");
		expect(ran.data).toEqual({ files: 2 });
		expect(await read("files/docs/private/plan.md")).toBe("# Secret plan\n");
		expect(await read("files/notes.md")).toBe("n");

		// A later sync replaces what the folder had.
		await sh(repo, "rm notes.md");
		const again = await step(kit("kit:knowledge/files"), "sync", {
			from: "notes.*",
		});
		expect(again.outcome).toBe("nothing");
		expect(await read("files/notes.md")).toBe("n");
		const one = await step(kit("kit:knowledge/files"), "sync", {
			from: "docs/private",
		});
		expect(one.data).toEqual({ files: 1 });
		await expect(read("files/notes.md")).rejects.toThrow();
	});

	test("folder: copies a folder anywhere on the computer, hidden files left out", async () => {
		const notes = join(root, "notes");
		await mkdir(join(notes, "specs"), { recursive: true });
		await mkdir(join(notes, ".obsidian"), { recursive: true });
		await writeFile(join(notes, "a.md"), "# A\n");
		await writeFile(join(notes, "specs", "b.md"), "# B\n");
		await writeFile(join(notes, "c.txt"), "c");
		await writeFile(join(notes, ".obsidian", "app.json"), "{}");

		const all = await step(kit("kit:knowledge/folder"), "sync", {
			path: notes,
		});
		expect(all.outcome).toBe("synced");
		expect(all.data).toEqual({ files: 3 });
		expect(await read("folder/specs/b.md")).toBe("# B\n");

		// Patterns pick the files, also in folders below. A sync replaces the folder.
		const md = await step(kit("kit:knowledge/folder"), "sync", {
			path: notes,
			patterns: "*.md\nspecs",
			folder: "folder",
		});
		expect(md.data).toEqual({ files: 2 });
		await expect(read("folder/c.txt")).rejects.toThrow();

		// ~ is the home folder.
		const home = await step(
			kit("kit:knowledge/folder"),
			"sync",
			{ path: "~/notes", patterns: "c.txt" },
			{},
			{ env: { HOME: root } },
		);
		expect(home.data).toEqual({ files: 1 });
		expect(await read("folder/c.txt")).toBe("c");
	});

	test("folder: nothing to copy, or not a full path, leaves the folder as it was", async () => {
		await mkdir(join(knowledge, "folder"), { recursive: true });
		await writeFile(join(knowledge, "folder", "kept.md"), "kept");
		const missing = await step(kit("kit:knowledge/folder"), "sync", {
			path: join(root, "nope"),
		});
		expect(missing.outcome).toBe("nothing");
		const none = await step(kit("kit:knowledge/folder"), "sync", {
			path: repo,
			patterns: "*.pdf",
		});
		expect(none.outcome).toBe("nothing");
		const relative = await step(kit("kit:knowledge/folder"), "sync", {
			path: "notes",
		});
		expect(relative.outcome).toBe("fail");
		expect(await read("folder/kept.md")).toBe("kept");
		expect(await readdir(knowledge)).toEqual(["folder"]);
	});

	test("github-wiki: clones the wiki, then takes the newest pages", async () => {
		const wiki = join(root, "project.wiki.git");
		const work = join(root, "wiki-work");
		await sh(root, `git init -q --bare -b master "${wiki}"`);
		await sh(
			root,
			`git clone -q "${wiki}" "${work}" 2>/dev/null; cd "${work}" && printf '# Home\\n' > Home.md && git add Home.md && git commit -qm home && git push -q origin HEAD`,
		);
		const url = `file://${wiki}`;
		const first = await step(kit("kit:knowledge/github-wiki"), "sync", {
			repo: url,
		});
		expect(first.outcome).toBe("synced");
		expect(first.data).toEqual({ files: 1 });
		expect(await read("wiki/Home.md")).toBe("# Home\n");

		await sh(
			work,
			"printf '# Setup\\n' > Setup.md && git add Setup.md && git commit -qm setup && git push -q origin HEAD",
		);
		const second = await step(kit("kit:knowledge/github-wiki"), "sync", {
			repo: url,
		});
		expect(second.data).toEqual({ files: 2 });
		expect(await read("wiki/Setup.md")).toBe("# Setup\n");
	});

	test("web: each page through the reader, named after its address", async () => {
		await writeFile(join(fixtures, "curl.out"), "Title: Docs\n\nThe docs.");
		const ran = await step(kit("kit:knowledge/web"), "sync", {
			urls: "https://example.com/docs?page=1\nhttps://example.org",
		});
		expect(ran.outcome).toBe("synced");
		expect(ran.data).toEqual({ files: 2 });
		expect(await read("web/example.com-docs-page-1.md")).toBe(
			"Title: Docs\n\nThe docs.",
		);
		expect(await calls()).toEqual([
			"curl -fsSL --max-time 120 https://r.jina.ai/https://example.com/docs?page=1",
			"curl -fsSL --max-time 120 https://r.jina.ai/https://example.org",
		]);
	});

	test("jira: each work item as markdown, its description as text", async () => {
		await fixture("jira-workitem", {
			key: "PROJ-1",
			fields: {
				summary: "Log in",
				issuetype: { name: "Story" },
				status: { name: "To Do" },
				description: {
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "A person logs in." }],
						},
						{
							type: "paragraph",
							content: [{ type: "text", text: "With a password." }],
						},
					],
				},
			},
		});
		const ran = await step(kit("kit:knowledge/jira"), "sync", {
			keys: "PROJ-1, PROJ-2",
			tool: "acli-dimpact",
		});
		expect(ran.outcome).toBe("synced");
		expect(ran.data).toEqual({ files: 2 });
		expect(await read("jira/PROJ-1.md")).toBe(
			"# PROJ-1: Log in\n\nType: Story\nStatus: To Do\n\nA person logs in.\n\nWith a password.\n\n\n",
		);
		expect(await calls()).toEqual([
			"acli-dimpact jira workitem view PROJ-1 --json",
			"acli-dimpact jira workitem view PROJ-2 --json",
		]);
	});

	test("confluence: each page as markdown, with the token as a secret", async () => {
		await writeFile(
			join(fixtures, "curl.out"),
			JSON.stringify({
				title: "Runbook",
				body: {
					storage: {
						value:
							"<h1>Start</h1><p>Run it &amp; check.</p><ul><li>One</li></ul>",
					},
				},
			}),
		);
		const ran = await step(
			kit("kit:knowledge/confluence"),
			"sync",
			{
				site: "https://team.example.net/wiki",
				email: "me@example.net",
				pages: "123",
			},
			{},
			{ env: { CONFLUENCE_API_TOKEN: "t0ken" } },
		);
		expect(ran.outcome).toBe("synced");
		expect(await read("confluence/123.md")).toBe(
			"# Runbook\n\n\n## Start\nRun it & check.\n- One\n\n\n",
		);
		expect(await calls()).toEqual([
			"curl -fsS --max-time 120 -u me@example.net:t0ken -H Accept: application/json https://team.example.net/wiki/api/v2/pages/123?body-format=storage",
		]);
	});
});

describe("kit:knowledge/review-learnings", () => {
	const flow = () => kit("kit:knowledge/review-learnings");
	const proposed = () => join(knowledge, "learnings", "proposed");

	test("nothing proposed: nothing to review", async () => {
		const ran = await step(flow(), "list", {});
		expect(ran.outcome).toBe("none");
	});

	test("lists the proposals as text, then keeps only those it showed", async () => {
		await mkdir(proposed(), { recursive: true });
		await writeFile(
			join(proposed(), "run-1.md"),
			'# Learnings of run run-1\n\n- Use "bun test", not npm.\n- Paths use \\ on Windows.\n',
		);
		const listed = await step(flow(), "list", {});
		expect(listed.outcome).toBe("review");
		expect(listed.data).toEqual({
			files: " run-1.md",
			text: '# Learnings of run run-1\n\n- Use "bun test", not npm.\n- Paths use \\ on Windows.\n',
		});
		// A proposal that came in while the Gate waited stays.
		await writeFile(join(proposed(), "run-2.md"), "- Later.\n");
		const kept = await step(
			flow(),
			"keep",
			{},
			{ list: { data: listed.data } },
		);
		expect(kept.outcome).toBe("pass");
		expect(
			await readFile(join(knowledge, "learnings/accepted/run-1.md"), "utf8"),
		).toContain("- Use");
		await expect(readFile(join(proposed(), "run-1.md"))).rejects.toThrow();
		expect(await readFile(join(proposed(), "run-2.md"), "utf8")).toBe(
			"- Later.\n",
		);

		const again = await step(flow(), "list", {});
		const deleted = await step(
			flow(),
			"delete",
			{},
			{ list: { data: again.data } },
		);
		expect(deleted.outcome).toBe("pass");
		await expect(readFile(join(proposed(), "run-2.md"))).rejects.toThrow();
	});
});
