/**
 * What the templates and rules of a node read: other nodes, inputs,
 * variables and `run`. "Make subflow from section" moves the reads that
 * cross a Section's frame (`readsOf`). The canvas draws a dotted line from
 * each node to the nodes that read it (`dataLinks`).
 */
import type { Flow, FlowNode } from "../flow";
import {
	ruleNames,
	ruleRefs,
	ruleVariableNames,
	templateRefs,
} from "../template";
import { checkNodeWith } from "../validate";
import { rewriteOwnTemplates } from "./refs";

/** A template a node holds. `self`: a variable write's value, where the node's id reads the step that just ended. */
type Text = { text: string; self: boolean };

/** One reference of a node's template or rule to a node, an input, a variable or `run`. */
export type NodeRead = {
	reader: { node: string };
	name: string;
	/** The path below the name; rules give none. */
	path: string[];
	self: boolean;
	rule: boolean;
};

/** The templates of a node: its own, then the values of its variable writes. */
function templatesOf(node: FlowNode): Text[] {
	const texts: Text[] = [];
	rewriteOwnTemplates(node, (text) => {
		texts.push({ text, self: false });
		return text;
	});
	for (const write of node.set ?? []) {
		if (write.value !== undefined)
			texts.push({ text: write.value, self: true });
	}
	return texts;
}

/** The rules (JSONata) of a node: a Decision's `when`, a Value's expression, the expressions of its writes. */
export function rulesOf(node: FlowNode): Text[] {
	const rules: Text[] = [];
	if (node.type === "decision") {
		for (const option of node.options) {
			if (option.when !== undefined && option.when.trim() !== "")
				rules.push({ text: option.when, self: false });
		}
	}
	if (node.type === "value" && node.expression !== undefined) {
		rules.push({ text: node.expression, self: false });
	}
	for (const write of node.set ?? []) {
		if (write.expression !== undefined && write.expression.trim() !== "")
			rules.push({ text: write.expression, self: true });
	}
	return rules;
}

/** Every reference the node's templates and rules make. */
export function readsOf(node: FlowNode): NodeRead[] {
	const reader = { node: node.id };
	const reads: NodeRead[] = [];
	for (const { text, self } of templatesOf(node)) {
		for (const ref of templateRefs(text)) {
			reads.push({
				reader,
				name: ref.name,
				path: ref.path,
				self,
				rule: false,
			});
		}
	}
	for (const { text, self } of rulesOf(node)) {
		for (const name of ruleNames(text))
			reads.push({ reader, name, path: [], self, rule: true });
		for (const variable of ruleVariableNames(text))
			reads.push({ reader, name: "vars", path: [variable], self, rule: true });
	}
	return reads;
}

/** The node `to` reads the node `from` in its templates or rules. */
export type DataLink = {
	from: string;
	to: string;
	/** What it reads below the node, each once, in order: `data.tasks`, `outcome`. */
	refs: string[];
};

/**
 * Which node reads which: one link per pair of nodes, from the templates,
 * the rules and the variable writes of every node. Only nodes of the flow
 * count, not inputs, `vars` or `run`. A node that reads itself has no link.
 */
export function dataLinks(flow: Flow): DataLink[] {
	const nodes = new Set(flow.nodes.map((node) => node.id));
	// A template reads an input before a node of the same name.
	for (const input of flow.inputs) nodes.delete(input.name);
	const links = new Map<string, DataLink>();
	for (const node of flow.nodes) {
		for (const { name, path } of nodeReads(node)) {
			if (name === node.id || !nodes.has(name)) continue;
			const key = `${name} ${node.id}`;
			let link = links.get(key);
			if (!link) {
				link = { from: name, to: node.id, refs: [] };
				links.set(key, link);
			}
			const ref = path.join(".");
			if (ref !== "" && !link.refs.includes(ref)) link.refs.push(ref);
		}
	}
	return [...links.values()];
}

/**
 * The names the node reads, each with its path, in order. Its own fields
 * come from the flow check (`checkNodeWith`), so every field the check
 * reads counts, a new one too. Then the values and the expressions of its
 * variable writes. A rule's own names (`previous`, `current`) are no reads.
 */
function nodeReads(node: FlowNode): { name: string; path: string[] }[] {
	const reads: { name: string; path: string[] }[] = [];
	const template = (text: string) => {
		reads.push(...templateRefs(text));
	};
	const rule = (text: string, also: readonly string[] = []) => {
		for (const ref of ruleRefs(text)) {
			if (!also.includes(ref.name)) reads.push(ref);
		}
	};
	const skip = () => {};
	checkNodeWith(node, {
		error: skip,
		warning: skip,
		template,
		commandTemplate: template,
		rule: (text, _subject, also) => rule(text, also),
		// These read only `event` or `data`, never a node.
		eventRule: skip,
		dataRule: skip,
		routed: () => true,
		section: () => null,
	});
	for (const write of node.set ?? []) {
		if (write.value !== undefined) template(write.value);
		if (write.expression !== undefined) rule(write.expression);
	}
	return reads;
}
