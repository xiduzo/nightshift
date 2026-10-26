import { gitFilesCommand, githubSubIssuesCommand } from "../recipes";

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
 *

 * Any version:
 * - The built-in tool set `tools: ["github"]` → the CLI tool `clis: ["gh"]`
 *   (see `migrateToolSets`).
 * - The old Claude Code decider → the default decider (see `migrateDecider`).
 * - A list source `kind: "github"` → a `command` source that asks `gh`
 *   for the same items (see `migrateListSource`).
 */
export function migrateFlow(json: unknown): unknown {
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
 * Version 5 → 6. Steps of the node review land here, one per change.
 */
export function migrateV5(
	json: Record<string, unknown>,
): Record<string, unknown> {
	const nodes = Array.isArray(json.nodes)
		? json.nodes.map((node) =>
				migrateAgentNode(migrateFilesSource(dropUnreadDeciders(node))),
			)
		: json.nodes;
	return {
		...json,
		version: 6,
		...(nodes === undefined ? {} : { nodes }),
	};
}

/**
 * A Decision by a person or a rule, and a Value by a rule, lose `decider`
 * and `model`: the schema wrote a default decider into every one of them,
 * and only a model reads it. Returns the input unchanged otherwise.
 */
function dropUnreadDeciders(json: unknown): unknown {
	if (!isRecord(json)) return json;
	if (json.type !== "decision" && json.type !== "value") return json;
	if (json.by === "model") return json;
	if (!("decider" in json) && !("model" in json)) return json;
	const { decider: _decider, model: _model, ...rest } = json;
	return rest;
}

/**
 * A Call node with `each` whose source was `kind: "files"` reads the same
 * items from a `command` source: `gitFilesCommand` on the same glob.
 * Returns the input unchanged when it is any other node or source.
 */
function migrateFilesSource(json: unknown): unknown {
	if (!isRecord(json) || json.type !== "call") return json;
	const each = json.each;
	if (!isRecord(each)) return json;
	const source = each.source;
	if (!isRecord(source) || source.kind !== "files") return json;
	if (typeof source.glob !== "string") return json;
	return {
		...json,
		each: {
			...each,
			source: { kind: "command", command: gitFilesCommand(source.glob) },
		},
	};
}

/**
 * An Agent node loses `checker`: a Decision by a model after the Agent does
 * its job. It loses `mcpServers`: Connections give an Agent its MCP
 * servers, and keep their secrets off the flow file. `nodeClis` joins
 * `clis`: one list of the programs the agent may run, the node's CLI tools
 * first. Returns the input unchanged when it is any other node.
 */
function migrateAgentNode(json: unknown): unknown {
	if (!isRecord(json) || json.type !== "agent") return json;
	const {
		checker: _checker,
		mcpServers: _mcpServers,
		nodeClis,
		...rest
	} = json;
	const names = (value: unknown) =>
		Array.isArray(value)
			? value.filter((name): name is string => typeof name === "string")
			: [];
	const clis = [...new Set([...names(rest.clis), ...names(nodeClis)])];
	if (clis.length > 0) return { ...rest, clis };
	const { clis: _clis, ...without } = rest;
	return without;
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
 * Version 3 → 4. A Subflow node becomes a Call node (`type: "call"`, the
 * rest as it was); a For Each node a Call node whose list fields (`source`,
 * `as`, `branch`, `haltOn`, `maxItems`) move under `each`, unchanged. Edges
 * keep their outcomes: `pass`/`fail` for a Call, `done`/`halted` for a
 * Call with `each`.
 */
export function migrateCallNodes(
	json: Record<string, unknown>,
): Record<string, unknown> {
	const nodes = Array.isArray(json.nodes)
		? json.nodes.map((node) => {
				if (!isRecord(node)) return node;
				switch (node.type) {
					case "subflow":
						return { ...node, type: "call" };
					case "foreach": {
						const { source, as, branch, haltOn, maxItems, ...rest } = node;
						return {
							...rest,
							type: "call",
							each: {
								source,
								...(as === undefined ? {} : { as }),
								...(branch === undefined ? {} : { branch }),
								...(haltOn === undefined ? {} : { haltOn }),
								...(maxItems === undefined ? {} : { maxItems }),
							},
						};
					}
					default:
						return node;
				}
			})
		: json.nodes;
	return {
		...json,
		version: 4,
		...(nodes === undefined ? {} : { nodes }),
	};
}

/**
 * Version 2 → 3. A Gate node becomes a Decision node decided by a person
 * (`by: "person"`, `prompt: question`, `options: choices`); a Decision node
 * one decided by a model (`by: "model"`, `options: labels`). Its `decider`
 * and `model` stay for `migrateDecider`.
 * Every template of the flow that read `{{<decision>.notes}}` reads
 * `{{<decision>.note}}`, the one field both have now.
 */
export function migrateDecisionNodes(
	json: Record<string, unknown>,
): Record<string, unknown> {
	const nodes = Array.isArray(json.nodes) ? json.nodes : [];
	const decisions = new Set<string>();
	for (const node of nodes) {
		if (
			isRecord(node) &&
			node.type === "decision" &&
			typeof node.id === "string"
		)
			decisions.add(node.id);
	}
	const text = (value: unknown) =>
		typeof value === "string" ? migrateNotes(value, decisions) : value;
	const migratedNodes = nodes.map((node) => {
		if (!isRecord(node)) return node;
		switch (node.type) {
			case "gate": {
				const { question, choices, ...rest } = node;
				return {
					...rest,
					type: "decision",
					prompt: text(question),
					options: choices,
					by: "person",
				};
			}
			case "decision": {
				const { labels, ...rest } = node;
				return {
					...rest,
					prompt: text(node.prompt),
					options: labels,
					by: "model",
				};
			}
			default:
				return rewriteTemplatesV2(node, text);
		}
	});
	const outputs = Array.isArray(json.outputs)
		? json.outputs.map((output) =>
				isRecord(output) ? { ...output, value: text(output.value) } : output,
			)
		: json.outputs;
	return {
		...json,
		version: 3,
		nodes: migratedNodes,
		...(outputs === undefined ? {} : { outputs }),
	};
}

/** Applies `text` to every template of a version 2 node that is not a Decision or a Gate. */
function rewriteTemplatesV2(
	node: Record<string, unknown>,
	text: (value: unknown) => unknown,
): Record<string, unknown> {
	const bindings = (inputs: unknown) =>
		isRecord(inputs)
			? Object.fromEntries(
					Object.entries(inputs).map(([name, value]) => [name, text(value)]),
				)
			: inputs;
	switch (node.type) {
		case "agent":
			return { ...node, prompt: text(node.prompt) };
		case "command":
			return { ...node, command: text(node.command) };
		case "subflow":
			return { ...node, inputs: bindings(node.inputs) };
		case "foreach": {
			const source = isRecord(node.source)
				? Object.fromEntries(
						Object.entries(node.source).map(([key, value]) => [
							key,
							key === "value" ||
							key === "command" ||
							key === "parent" ||
							key === "glob"
								? text(value)
								: value,
						]),
					)
				: node.source;
			return { ...node, source, inputs: bindings(node.inputs) };
		}
		default:
			return node;
	}
}

/** `{{<decision>.notes}}` → `{{<decision>.note}}`, for the ids in `decisions`. */
function migrateNotes(text: string, decisions: ReadonlySet<string>): string {
	return text.replace(
		/\{\{\s*([a-z][a-z0-9_]*)\.notes\s*\}\}/g,
		(raw: string, name: string) =>
			decisions.has(name) ? `{{${name}.note}}` : raw,
	);
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

function migrateV1(json: Record<string, unknown>): Record<string, unknown> {
	const { version: _version, input, params, ...rest } = json;
	const { description, policy, start, nodes, edges, ...others } = rest;

	/** Param names a template reads, declared or not. */
	const read = new Set<string>();
	const text = (value: unknown) =>
		typeof value === "string" ? migrateTemplate(value, read) : value;

	const migratedNodes = Array.isArray(nodes)
		? nodes.map((node) => migrateNode(node, text))
		: nodes;

	const inputs: Record<string, unknown>[] = [];
	if (input === "item") {
		inputs.push({ name: "item", type: "json", required: true });
	}
	const declared = new Set<string>();
	for (const param of Array.isArray(params) ? params : []) {
		if (!isRecord(param)) continue;
		if (typeof param.name === "string") declared.add(param.name);
		inputs.push({ ...param, type: "text" });
	}
	// A version 1 body read the params of the flow that ran it, without
	// declaring them. Now it takes them as inputs, and its caller binds them.
	for (const name of read) {
		if (!declared.has(name) && name !== "item") {
			inputs.push({
				name,
				type: "text",
				description: "A run parameter in version 1 of this flow.",
				required: true,
			});
		}
	}

	return {
		version: 2,
		...(description === undefined ? {} : { description }),
		inputs,
		outputs: [],
		...(policy === undefined ? {} : { policy }),
		start,
		nodes: migratedNodes,
		edges,
		...others,
	};
}

/** Version 1 references: `{{scope.field}}`, nothing else. */
const V1_REF = /\{\{\s*([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\s*\}\}/g;

const itemFieldsV2: Readonly<Record<string, string>> = {
	parent_number: "item.parent.number",
	parent_title: "item.parent.title",
	branch: "run.branch",
	base_branch: "run.base_branch",
	index: "run.index",
};

/** Rewrites the version 1 references of one template. Adds read params to `read`. */
function migrateTemplate(text: string, read: Set<string>): string {
	return text.replace(V1_REF, (raw: string, scope: string, field: string) => {
		if (scope === "params") {
			read.add(field);
			return `{{${field}}}`;
		}
		if (scope === "item" && Object.hasOwn(itemFieldsV2, field)) {
			return `{{${itemFieldsV2[field]}}}`;
		}
		return raw;
	});
}

function migrateNode(
	node: unknown,
	text: (value: unknown) => unknown,
): unknown {
	if (!isRecord(node)) return node;
	switch (node.type) {
		case "agent":
		case "decision":
			return { ...node, prompt: text(node.prompt) };
		case "command":
			return { ...node, command: text(node.command) };
		case "gate":
			return { ...node, question: text(node.question) };
		case "foreach": {
			const { branchPerItem, ...rest } = node;
			const source = isRecord(node.source)
				? {
						...node.source,
						...("parent" in node.source
							? { parent: text(node.source.parent) }
							: {}),
						...("command" in node.source
							? { command: text(node.source.command) }
							: {}),
					}
				: node.source;
			return {
				...rest,
				source,
				as: "item",
				branch: branchPerItem === false ? "shared" : "per-item",
			};
		}
		default:
			return node;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
