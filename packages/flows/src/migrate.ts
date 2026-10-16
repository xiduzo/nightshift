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
 * Any version: the built-in tool set `tools: ["github"]` → the CLI tool
 * `clis: ["gh"]` (see `migrateToolSets`), and the old Claude Code decider
 * → the default decider (see `migrateDecider`).
 */
export function migrateFlow(json: unknown): unknown {
	const current = isRecord(json) && json.version === 1 ? migrateV1(json) : json;
	if (!isRecord(current) || !Array.isArray(current.nodes)) return current;
	let changed = false;
	const nodes = current.nodes.map((node) => {
		const migrated = migrateDecider(migrateToolSets(node));
		if (migrated !== node) changed = true;
		return migrated;
	});
	return changed ? { ...current, nodes } : current;
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
