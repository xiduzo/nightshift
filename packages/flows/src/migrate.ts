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
 * Any version:
 * - The built-in tool set `tools: ["github"]` → the CLI tool `clis: ["gh"]`
 *   (see `migrateToolSets`).
 * - A For Each source `kind: "github"` → a `command` source that asks `gh`
 *   for the same items (see `migrateListSource`).
 */
export function migrateFlow(json: unknown): unknown {
	let current = isRecord(json) && json.version === 1 ? migrateV1(json) : json;
	if (isRecord(current) && current.version === 2) {
		current = migrateDecisionNodes(current);
	}
	if (!isRecord(current) || !Array.isArray(current.nodes)) return current;
	let changed = false;
	const nodes = current.nodes.map((node) => {
		const migrated = migrateListSource(migrateToolSets(node));
		if (migrated !== node) changed = true;
		return migrated;
	});
	return changed ? { ...current, nodes } : current;
}

/**
 * The GitHub source the engine read itself, before the List Source had
 * three adapters: the sub-issues of one parent issue.
 */
type GithubSource = {
	parent: string;
	requireLabel?: string;
	doneLabels?: string[];
	skipLabels?: string[];
};

/**
 * A For Each node whose source was `kind: "github"` reads the same items
 * from a `command` source: `githubSubIssuesCommand` on `gh`. Returns the
 * input unchanged when it is any other node or source.
 */
export function migrateListSource(json: unknown): unknown {
	if (!isRecord(json) || json.type !== "foreach") return json;
	const source = json.source;
	if (!isRecord(source) || source.kind !== "github") return json;
	if (typeof source.parent !== "string") return json;
	const labels = (value: unknown) =>
		Array.isArray(value)
			? value.filter((label): label is string => typeof label === "string")
			: [];
	return {
		...json,
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
	};
}

/** One parent issue with its sub-issues and their "blocked by" links. GitHub allows 100 sub-issues per issue. */
const SUB_ISSUES_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      number title
      subIssues(first: 100) {
        nodes {
          number title body state url
          labels(first: 30) { nodes { name } }
          blockedBy(first: 50) { nodes { number state } }
        }
      }
    }
  }
}`;

/**
 * The jq that turns the query's answer into list items. The first line holds
 * the filters, so a person can edit them in place: `$require` (a label a
 * sub-issue must have, or null), `$skip` (labels that leave a sub-issue
 * out) and `$done` (labels that count as done, like a closed issue). Label
 * names in lowercase.
 */
const SUB_ISSUES_FILTER = `.data.repository.issue as $parent
| [ $parent.subIssues.nodes[]
    | (.labels.nodes | map(.name | ascii_downcase)) as $labels
    | select($require == null or any($labels[]; . == $require))
    | select(any($labels[]; IN($skip[])) | not)
    | { id: (.number | tostring), number, title, body: (.body // ""), url, state,
        labels: [.labels.nodes[].name],
        parent: { number: $parent.number, title: $parent.title },
        dependsOn: [ .blockedBy.nodes[] | { id: (.number | tostring), done: (.state == "CLOSED") } ],
        done: (.state == "CLOSED" or any($labels[]; IN($done[]))) } ]`;

/**
 * A source command that prints the sub-issues of one GitHub issue as list
 * items, through `gh api graphql` in the worktree's repository. Each item
 * is `{ id, number, title, body, url, state, labels, parent: { number,
 * title }, dependsOn: [{ id, done }], done }`: `id` is the issue number as
 * text, `dependsOn` comes from the "blocked by" links, and `done` is a
 * closed issue or one of `doneLabels`. A sub-issue without `requireLabel`
 * or with one of `skipLabels` is left out. Labels match without case.
 * `parent` is a template for the issue number, for example `{{epic}}`: the
 * command adapter passes it as an environment variable.
 */
export function githubSubIssuesCommand(source: GithubSource): string {
	const lower = (labels: readonly string[]) =>
		labels.map((label) => label.toLowerCase());
	const knobs = [
		`${jqValue(source.requireLabel?.toLowerCase() ?? null)} as $require`,
		`${jqValue(lower(source.skipLabels ?? []))} as $skip`,
		`${jqValue(lower(source.doneLabels ?? []))} as $done`,
	].join(" | ");
	return [
		`gh api graphql -F owner='{owner}' -F name='{repo}' -F number="${source.parent}" -f query='`,
		`${SUB_ISSUES_QUERY}' --jq '`,
		`${knobs}`,
		`| ${SUB_ISSUES_FILTER}'`,
	].join("\n");
}

/** A jq literal inside the single-quoted shell argument: JSON, with any `'` escaped for the shell. */
function jqValue(value: string | string[] | null): string {
	return JSON.stringify(value).replace(/'/g, `'\\''`);
}

/**
 * Version 2 → 3. A Gate node becomes a Decision node decided by a person
 * (`by: "person"`, `prompt: question`, `options: choices`); a Decision node
 * one decided by a model (`by: "model"`, `options: labels`, no `decider`).
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
				const { labels, decider: _decider, ...rest } = node;
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
