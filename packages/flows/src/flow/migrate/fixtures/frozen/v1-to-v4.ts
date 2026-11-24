import { isRecord } from "./record";

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

function migrateNotes(text: string, decisions: ReadonlySet<string>): string {
	return text.replace(
		/\{\{\s*([a-z][a-z0-9_]*)\.notes\s*\}\}/g,
		(raw: string, name: string) =>
			decisions.has(name) ? `{{${name}.note}}` : raw,
	);
}

export function migrateV1(
	json: Record<string, unknown>,
): Record<string, unknown> {
	const { version: _version, input, params, ...rest } = json;
	const { description, policy, start, nodes, edges, ...others } = rest;

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

const V1_REF = /\{\{\s*([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\s*\}\}/g;

const itemFieldsV2: Readonly<Record<string, string>> = {
	parent_number: "item.parent.number",
	parent_title: "item.parent.title",
	branch: "run.branch",
	base_branch: "run.base_branch",
	index: "run.index",
};

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
