import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "../flow";
import { folderNeeds, runsGitHere } from "./folder";

const at = { x: 0, y: 0 };

/** A flow of these nodes, with no edges: the order of the nodes is all that counts here. */
function flowOf(nodes: Record<string, unknown>[]): Flow {
	return flowSchema.parse({
		version: FLOW_VERSION,
		start: nodes[0]?.id ?? "a",
		nodes: nodes.map((node) => ({ position: at, ...node })),
		edges: [],
	});
}

const call = (id: string, flow: string, extra: object = {}) => ({
	id,
	type: "call",
	flow,
	...extra,
});
const command = (id: string, text: string) => ({
	id,
	type: "command",
	command: text,
});
const agent = (id: string, prompt: string) => ({
	id,
	type: "agent",
	prompt,
	harness: "claude-code",
	model: "sonnet",
});

describe("folderNeeds: kits", () => {
	test("a Subflow that runs a GitHub kit, a tier that runs one, and the Project files sync", () => {
		const flow = flowOf([
			call("publish", "kit:github/publish-draft-pr"),
			call("tell", "kit:message/send"),
			call("try", "kit:message/send", {
				cascade: [{ flow: "kit:github/watch-pr" }],
			}),
			call("notes", "kit:knowledge/files"),
			call("wiki", "kit:knowledge/wiki"),
		]);
		expect(folderNeeds(flow)).toEqual([
			{
				nodeId: "publish",
				need: {
					kind: "kit",
					kit: "kit:github/publish-draft-pr",
					label: "Publish a draft pull request",
				},
			},
			{
				nodeId: "try",
				need: {
					kind: "kit",
					kit: "kit:github/watch-pr",
					label: "Watch a pull request",
				},
			},
			{
				nodeId: "notes",
				need: {
					kind: "kit",
					kit: "kit:knowledge/files",
					label: "Knowledge: Project files",
				},
			},
		]);
	});

	test("a kit's own steps count only through its kit: the wiki sync clones, the GitHub kits are one need each", () => {
		const flow = flowOf([call("branch", "kit:github/create-branch")]);
		expect(folderNeeds(flow).map(({ need }) => need.kind)).toEqual(["kit"]);
	});
});

describe("folderNeeds: the node's own steps", () => {
	test("a command, a Wait's command and a list's command that run git", () => {
		const flow = flowOf([
			command("commit", "git add -A\ngit commit -m 'Night notes'"),
			{
				id: "ready",
				type: "wait",
				until: { kind: "command", command: "git fetch", everyMinutes: 5 },
			},
			call("each", "fix", {
				each: {
					as: "sha",
					source: { kind: "command", command: "git log --format=%H -n 3" },
				},
			}),
			command("fetch", "curl -s https://example.com/feed.xml"),
		]);
		expect(folderNeeds(flow)).toEqual([
			{ nodeId: "commit", need: { kind: "git" } },
			{ nodeId: "ready", need: { kind: "git" } },
			{ nodeId: "each", need: { kind: "git" } },
		]);
	});

	test("templates and rules that read a branch, each field once per node", () => {
		const flow = flowOf([
			agent(
				"plan",
				"Plan {{run.branch}} against {{run.base_ref}}. Again: {{run.branch}}.",
			),
			{
				id: "which",
				type: "decision",
				prompt: "Which?",
				options: [
					{ name: "main", when: 'run.base_branch = "main"' },
					{ name: "other" },
				],
				by: "rule",
			},
			agent("where", "Work in {{run.worktree}} for {{run.flow}}."),
		]);
		expect(folderNeeds(flow)).toEqual([
			{ nodeId: "plan", need: { kind: "branch", field: "branch" } },
			{ nodeId: "plan", need: { kind: "branch", field: "base_ref" } },
			{ nodeId: "which", need: { kind: "branch", field: "base_branch" } },
		]);
	});
});

describe("folderNeeds: the flows a Subflow runs", () => {
	const publish = flowOf([
		command("check", "git status --short"),
		call("open", "kit:github/publish-draft-pr"),
	]);
	const outer = flowOf([call("ship", "publish"), call("plain", "notes")]);
	const notes = flowOf([command("write", "echo done > notes.md")]);

	test("a need inside a called flow lands once on the Subflow node that runs it", () => {
		expect(folderNeeds(outer, { flows: { publish, notes } })).toEqual([
			{ nodeId: "ship", need: { kind: "flow", flow: "publish" } },
		]);
	});

	test("through two flows, and through a tier", () => {
		const middle = flowOf([call("inner", "publish")]);
		const flow = flowOf([
			call("deep", "middle"),
			call("tiered", "notes", { cascade: [{ flow: "publish" }] }),
		]);
		expect(folderNeeds(flow, { flows: { middle, publish, notes } })).toEqual([
			{ nodeId: "deep", need: { kind: "flow", flow: "middle" } },
			{ nodeId: "tiered", need: { kind: "flow", flow: "publish" } },
		]);
	});

	test("without the project's flows only kits count, and a call back to the flow adds nothing", () => {
		expect(folderNeeds(outer)).toEqual([]);
		const self = flowOf([call("again", "main"), command("log", "git log -1")]);
		expect(folderNeeds(self, { flows: { main: self }, name: "main" })).toEqual([
			{ nodeId: "log", need: { kind: "git" } },
		]);
	});
});

describe("runsGitHere", () => {
	test("git on the folder the command runs in", () => {
		for (const text of [
			"git status",
			"set -e\nsha=$(git rev-parse HEAD)",
			"if ! git diff --quiet; then echo changed; fi",
			"git -c user.name=night commit -m done",
			"echo start && git push origin HEAD",
			"GIT_PAGER=cat git log -1",
		]) {
			expect([text, runsGitHere(text)]).toEqual([text, true]);
		}
	});

	test("a clone, another folder, a call that needs no repository, or no call at all", () => {
		for (const text of [
			"git clone https://github.com/owner/name.git work && git -C work log -1",
			"mkdir -p site && cd site && git init && git add -A",
			"git -C /srv/site pull",
			"git --git-dir=/srv/site/.git log -1",
			"git ls-remote https://github.com/owner/name",
			"git --version",
			"git config --global user.name night",
			"echo 'git status'",
			"# git status",
			"gitleaks detect",
			"legit status",
		]) {
			expect([text, runsGitHere(text)]).toEqual([text, false]);
		}
	});
});
