import { githubSubIssuesCommand } from "../../recipes";
import { isRecord } from "./record";
import { migrateCallNodes, migrateDecisionNodes, migrateV1 } from "./v1-to-v4";
import {
	type FlowMigration,
	migrateV5,
	migrateV6,
	migrateV7,
	migrateV8,
} from "./v5-to-v9";

/**
 * Brings a flow file of an older version to the current one, as raw JSON,
 * before `parseFlow` checks it. Returns the input unchanged when it is
 * already current or not an object. Version 1 → 2:
 * - `params` → `inputs` (type `text`); `{{params.x}}` → `{{x}}`.
 * - `input: "item"` → an input `{ name: "item", type: "json", required: true }`.
 * - Item fields: `{{item.parent_number}}` → `{{item.parent.number}}`,
 *   `{{item.parent_title}}` → `{{item.parent.title}}`, `{{item.branch}}` →
 *   `{{run.branch}}`, `{{item.base_branch}}` → `{{run.base_branch}}`,
 *   `{{item.index}}` → `{{run.index}}`. Other `{{item.x}}` stay.
 * - For Each: `branchPerItem` → `branch` (`per-item` / `shared`), `as: "item"`.
 * - Every template in prompts, commands, questions, sources and outputs.
 *
 * Version 2 → 3 (`migrateDecisionNodes`): a Gate is a Decision decided by
 * a person, a Decision one decided by a model, and both have `options`.
 *
 * Version 3 → 4 (`migrateCallNodes`): a Subflow node is a Call node, and a
 * For Each node a Call node with `each`.
 *
 * Version 4 → 5: a flow can have variables (`variables`, `set`), read as
 * `{{vars.x}}`. Nothing to change: the version says an older Night Shift
 * cannot run the file, instead of dropping its variables. A node or an
 * input named `vars` is a validation error from now on.
 *
 * Version 5 → 6 (`migrateV5`): the node review of 2026-10 (see
 * `docs/research/node-review-2026-10.md`). Each change that needs a file
 * edit adds its step here.
 * - `decider` and `model` go from a Decision by a person or a rule and a
 *   Value by a rule: only a model reads them (`dropUnreadDeciders`).
 * - A list source `kind: "files"` → a `command` source that asks
 *   `git ls-files` for the same items (`migrateFilesSource`).
 * - Agent nodes (`migrateAgentNode`): `checker` and `mcpServers` go, and
 *   `nodeClis` joins `clis`.
 * - Two or more edges without a max on one outcome run all at once from
 *   now on (a fan-out). Before, the first one won and the others were never
 *   taken: those others go (`dropShadowedEdges`).
 *
 * Version 6 → 7 (`migrateV6`): a profile belongs to one Device (ADR 3).
 * A node names the pair `{ device, profile }` by ids instead of a profile
 * name: see `FlowMigration`.
 *
 * Version 7 → 8 (`migrateV7`): a node names its Device (`device`) by the
 * Device's id instead of its name (ADR 14). A name that the migration
 * cannot bring to one id becomes `{ name }`: the check asks to choose the
 * device again.
 *
 * Version 8 → 9 (`migrateV8`): output fields get a shape. A Command node's
 * `output` (`"text"` or `"json"`, what it prints) moves to `stdout`, and
 * `output` is its optional output schema, as on an Agent or a Value node.
 *
 * Any version:
 * - The built-in tool set `tools: ["github"]` → the CLI tool `clis: ["gh"]`
 *   (see `migrateToolSets`).
 * - The old Claude Code decider → the default decider (see `migrateDecider`).
 * - A list source `kind: "github"` → a `command` source that asks `gh`
 *   for the same items (see `migrateListSource`).
 */
export function migrateFlow(json: unknown, migration?: FlowMigration): unknown {
	let current = isRecord(json) && json.version === 1 ? migrateV1(json) : json;
	if (isRecord(current) && current.version === 2) {
		current = migrateDecisionNodes(current);
	}
	if (isRecord(current) && current.version === 3) {
		current = migrateCallNodes(current);
	}
	if (isRecord(current) && current.version === 4) {
		current = { ...current, version: 5 };
	}
	if (isRecord(current) && current.version === 5) {
		current = migrateV5(current);
	}
	if (isRecord(current) && current.version === 6) {
		current = migrateV6(current, migration);
	}
	if (isRecord(current) && current.version === 7) {
		current = migrateV7(current, migration);
	}
	if (isRecord(current) && current.version === 8) {
		current = migrateV8(current);
	}
	if (!isRecord(current) || !Array.isArray(current.nodes)) return current;
	let changed = false;
	const nodes = current.nodes.map((node) => {
		const migrated = migrateListSource(migrateDecider(migrateToolSets(node)));
		if (migrated !== node) changed = true;
		return migrated;
	});
	return changed ? { ...current, nodes } : current;
}

/**
 * A Call node with `each` whose source was `kind: "github"` reads the same
 * items from a `command` source: `githubSubIssuesCommand` on `gh`. Returns
 * the input unchanged when it is any other node or source.
 */
export function migrateListSource(json: unknown): unknown {
	if (!isRecord(json) || json.type !== "call") return json;
	const each = json.each;
	if (!isRecord(each)) return json;
	const source = each.source;
	if (!isRecord(source) || source.kind !== "github") return json;
	if (typeof source.parent !== "string") return json;
	const labels = (value: unknown) =>
		Array.isArray(value)
			? value.filter((label): label is string => typeof label === "string")
			: [];
	return {
		...json,
		each: {
			...each,
			source: {
				kind: "command",
				command: githubSubIssuesCommand({
					parent: source.parent,
					...(typeof source.requireLabel === "string"
						? { requireLabel: source.requireLabel }
						: {}),
					doneLabels: labels(source.doneLabels),
					skipLabels: labels(source.skipLabels),
				}),
			},
		},
	};
}

/**
 * A Decision node on the old Claude Code decider loses `decider` and its
 * Claude `model`, so it gets the default decider and that decider's model.
 * Returns the input unchanged otherwise.
 */
export function migrateDecider(json: unknown): unknown {
	if (!isRecord(json) || json.decider !== "claude-code") return json;
	const { decider: _decider, model: _model, ...rest } = json;
	return rest;
}

/**
 * An Agent node, Decision node or profile with the old `tools` field: the
 * GitHub tool set gave the agent `gh`, so `github` becomes the CLI tool
 * `gh`. A Decision node loses its tools. Returns the input unchanged when it
 * has no `tools`.
 */
export function migrateToolSets(json: unknown): unknown {
	if (!isRecord(json) || !("tools" in json)) return json;
	const { tools, ...rest } = json;
	const github = Array.isArray(tools) && tools.includes("github");
	if (!github || rest.type === "decision") return rest;
	const clis = Array.isArray(rest.clis) ? rest.clis : [];
	return { ...rest, clis: clis.includes("gh") ? clis : [...clis, "gh"] };
}
