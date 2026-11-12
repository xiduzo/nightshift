/**
 * What in a flow needs the project's folder (ADR 22). A run of a project
 * without one works in an empty folder of its own: no git history, no
 * branches, no GitHub repository. The editor warns at the step that fails
 * there, before a run does.
 */
import type { Flow, FlowNode } from "../flow";
import { folderKit, isKitName } from "../kits";
import { calledFlowNames } from "../nodes";
import { walkCalledFlows } from "../secrets";
import type { ProjectFlowMap } from "../validate";
import { callPattern, commandOf, withoutComment } from "./cli-programs";
import { nodeReads } from "./reads";

/**
 * The run fields that name a branch or a base: `{{run.branch}}`. Always
 * empty in a project without a folder, so the editor offers them only in
 * a project with one.
 */
export const BRANCH_RUN_FIELDS = ["branch", "base_branch", "base_ref"] as const;
type BranchField = (typeof BRANCH_RUN_FIELDS)[number];

/** What in a node needs the project's folder. */
export type FolderNeed =
	/** It runs a kit that works in the project's folder (`folderKit`). */
	| { kind: "kit"; kit: string; label: string }
	/** It runs a flow of the project that has a step with a need of its own. */
	| { kind: "flow"; flow: string }
	/** Its command runs git on the folder it runs in (`runsGitHere`). */
	| { kind: "git" }
	/** It reads `{{run.branch}}`, `{{run.base_branch}}` or `{{run.base_ref}}`. */
	| { kind: "branch"; field: BranchField };

/** A need, on the node of the flow that has it or runs the flow that has it. */
export type NodeFolderNeed = { nodeId: string; need: FolderNeed };

/**
 * Each place in `flow` that fails, or reads nothing, in a project without a
 * folder: a Subflow that runs a kit such as `kit:github/publish-draft-pr`,
 * a command that runs git, a template or rule that reads a branch. It
 * follows the flows and kits each Subflow runs (`walkCalledFlows`): a need
 * in a called flow lands on the Subflow node that runs it, once. A kit's
 * own steps count only through its `needsFolder`. `flows`: the project's
 * flows by name; without them only kits are known. `name`: the flow's own.
 */
export function folderNeeds(
	flow: Flow,
	options: { flows?: ProjectFlowMap; name?: string } = {},
): NodeFolderNeed[] {
	const found: NodeFolderNeed[] = [];
	const seen = new Set<string>();
	const add = (nodeId: string, need: FolderNeed) => {
		const key = `${nodeId}\u0000${JSON.stringify(need)}`;
		if (seen.has(key)) return;
		seen.add(key);
		found.push({ nodeId, need });
	};
	walkCalledFlows(flow, options, (node, _known, trail) => {
		const holder = trail.at(-1)?.flow;
		if (holder !== undefined && isKitName(holder)) return;
		const needs = nodeNeeds(node);
		const [first] = trail;
		if (first === undefined) {
			for (const need of needs) add(node.id, need);
		} else if (needs.length > 0) {
			add(first.node.id, { kind: "flow", flow: first.flow });
		}
	});
	return found;
}

/** The needs of one node, without the flows it runs. */
function nodeNeeds(node: FlowNode): FolderNeed[] {
	const needs: FolderNeed[] = [];
	if (node.type === "call") {
		for (const name of calledFlowNames(node)) {
			const kit = folderKit(name);
			if (kit) needs.push({ kind: "kit", kit: kit.name, label: kit.label });
		}
	}
	const command = commandOf(node);
	if (command !== undefined && runsGitHere(command))
		needs.push({ kind: "git" });
	for (const { name, path } of nodeReads(node)) {
		const field = BRANCH_RUN_FIELDS.find((candidate) => candidate === path[0]);
		if (name === "run" && field !== undefined) {
			needs.push({ kind: "branch", field });
		}
	}
	return needs;
}

/** git subcommands that need no repository in the folder they run in. */
const GIT_ANYWHERE = new Set([
	"clone",
	"init",
	"ls-remote",
	"config",
	"help",
	"version",
]);

/** git options that take the next word as their value. */
const GIT_VALUE_OPTIONS = new Set([
	"-C",
	"-c",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--exec-path",
	"--config-env",
]);

/** git options that point it at another folder than the one it runs in. */
const GIT_ELSEWHERE = ["-C", "--git-dir", "--work-tree"];

/** Each git call on a line: the words after `git`, up to the end of that command. */
function gitCalls(line: string): string[][] {
	const call = new RegExp(
		String.raw`${callPattern("git").source}([^;&|)\x60]*)`,
		"g",
	);
	return [...line.matchAll(call)].map((match) =>
		(match[1] ?? "").trim().split(/\s+/).filter(Boolean),
	);
}

/**
 * What a git call works on: another folder that an option names, or the
 * folder it runs in with its subcommand (null for `git --version`).
 */
type GitTarget =
	| { elsewhere: true }
	| { elsewhere: false; subcommand: string | null };

function gitTarget(args: readonly string[]): GitTarget {
	for (let i = 0; i < args.length; i++) {
		const word = args[i] ?? "";
		if (GIT_ELSEWHERE.some((o) => word === o || word.startsWith(`${o}=`)))
			return { elsewhere: true };
		if (GIT_VALUE_OPTIONS.has(word)) {
			i++;
			continue;
		}
		if (!word.startsWith("-")) return { elsewhere: false, subcommand: word };
	}
	return { elsewhere: false, subcommand: null };
}

/**
 * Whether a shell command runs git on the folder it runs in, which a
 * project without a folder leaves empty. Best effort: a command that makes
 * its own repository (`git clone`, `git init`) or moves to another folder
 * (`cd`, `pushd`) is left alone, and so is a git call that names another
 * folder (`-C`, `--git-dir`, `--work-tree`) or needs none (`ls-remote`,
 * `config`, `--version`).
 */
export function runsGitHere(command: string): boolean {
	const lines = command.split("\n").map(withoutComment);
	const moves = [callPattern("cd"), callPattern("pushd")];
	if (lines.some((line) => moves.some((move) => move.test(line)))) return false;
	const here = lines
		.flatMap(gitCalls)
		.map(gitTarget)
		.flatMap((target) =>
			target.elsewhere || target.subcommand === null ? [] : [target.subcommand],
		);
	if (
		here.some((subcommand) => subcommand === "clone" || subcommand === "init")
	)
		return false;
	return here.some((subcommand) => !GIT_ANYWHERE.has(subcommand));
}
