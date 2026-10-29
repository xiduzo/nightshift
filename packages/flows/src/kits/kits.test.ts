import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmod,
	mkdir,
	mkdtemp,
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
	dataExitFor,
	exitFor,
	type JsonValue,
} from "../nodes";
import { chooseByRule, renderCommand, runFields } from "../template";
import { isKitName, kitCopyName, kitFlow, kitList } from "./kits";

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
	await mkdir(repo);
	await mkdir(bin);
	await mkdir(fixtures);
	await writeFile(log, "");
	for (const name of ["gh", "acli"]) {
		await writeFile(join(bin, name), STUB);
		await chmod(join(bin, name), 0o755);
	}
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
 * Runs one Command node of a kit with the kit's input defaults under
 * `inputs`, and earlier steps' outputs as `nodes`. The outcome is the one
 * the engine picks: the data's, else the exit code's.
 */
async function step(
	flow: Flow,
	nodeId: string,
	inputs: Record<string, string>,
	nodes: Record<string, Record<string, JsonValue>> = {},
): Promise<Ran> {
	const node = flow.nodes.find(
		(candidate): candidate is CommandNode =>
			candidate.id === nodeId && candidate.type === "command",
	);
	if (!node) throw new Error(`no command ${nodeId}`);
	const values: Record<string, JsonValue> = {};
	for (const input of flow.inputs) values[input.name] = input.default ?? "";
	Object.assign(values, inputs);
	const run = Object.fromEntries(runFields.map((field) => [field, ""]));
	const { command, env } = renderCommand(node.command, {
		nodes,
		inputs: values,
		run: run as Record<(typeof runFields)[number], string>,
	});
	const output = join(root, `${nodeId}.json`);
	await writeFile(output, "");
	const proc = Bun.spawn(["sh", "-c", command], {
		cwd: repo,
		env: {
			...process.env,
			...GIT_ENV,
			...env,
			NS_OUTPUT: output,
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
	const text = (await readFile(output, "utf8")).trim();
	const data = text === "" ? null : (JSON.parse(text) as JsonValue);
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
});
