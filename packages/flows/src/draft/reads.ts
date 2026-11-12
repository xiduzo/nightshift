/**
 * What the texts of a flow read: other nodes, inputs, variables and `run`.
 * "Make subflow from section" moves the reads that cross a Section's frame
 * (`readsOf`). The canvas draws a dotted line from each node to the nodes
 * that read it (`dataLinks`), and an agent learns who reads what
 * (`flowReads`).
 */
import { type Flow, type FlowNode, nodeTexts } from "../flow";
import type { HeldText } from "../nodes";
import { ruleRefs, templateRefs } from "../template";
import { checkNodeWith } from "../validate";

/** Who reads: a node, an output of the flow, or the initial value of a variable. */
export type Reader =
	| { node: string }
	| { output: string }
	| { variable: string };

/** One reference of a text of the flow to a node, an input, a variable or `run`. */
export type FlowRead = {
	reader: Reader;
	name: string;
	/**
	 * The keys below the name, as far as they are plain:
	 * `data.tasks` in `{{plan.data.tasks}}` and in `plan.data.tasks[0]`.
	 */
	path: string[];
	/** A variable write's value or expression: the node's own id reads the step that just ended. */
	self: boolean;
	rule: boolean;
};

/** One reference of a node's text. */
export type NodeRead = FlowRead & { reader: { node: string } };

/** A text as the reads take it. */
type ReadText = Pick<HeldText, "text" | "kind" | "also" | "self">;

/**
 * The reads of one text: each reference of a template, each name a rule
 * reads at the top with the plain keys after it (`ruleRefs`). A rule's own
 * names (`previous`, `current`) are no reads.
 */
function readsIn(
	reader: { node: string },
	{ text, kind, also, self }: ReadText,
): NodeRead[] {
	const rule = kind === "rule";
	const refs = rule
		? ruleRefs(text).filter((ref) => !also.includes(ref.name))
		: templateRefs(text);
	return refs.map(({ name, path }) => ({ reader, name, path, self, rule }));
}

/**
 * Every reference the node's texts make (`nodeTexts`), a field it does not
 * use as it is set up now too: first its templates, then its rules.
 */
export function readsOf(node: FlowNode): NodeRead[] {
	const reader = { node: node.id };
	const texts = nodeTexts(node);
	return [
		...texts.filter((text) => text.kind !== "rule"),
		...texts.filter((text) => text.kind === "rule"),
	].flatMap((text) => readsIn(reader, text));
}

/**
 * The texts the node uses as it is set up now: the ones its check reads
 * (`checkNodeWith`), so every field the check reads counts, a new one too.
 * Then the values and the expressions of its variable writes.
 */
function textsInUse(node: FlowNode): ReadText[] {
	const texts: ReadText[] = [];
	const add = (text: ReadText) => {
		texts.push(text);
	};
	const skip = () => {};
	checkNodeWith(node, {
		error: skip,
		warning: skip,
		template: (text) => add({ text, kind: "template", also: [], self: false }),
		commandTemplate: (text) =>
			add({ text, kind: "command", also: [], self: false }),
		rule: (text, _subject, also = []) =>
			add({ text, kind: "rule", also, self: false }),
		// These read only `event` or `data`, never a name of the flow.
		eventRule: skip,
		dataRule: skip,
		routed: () => true,
		section: () => null,
	});
	return [...texts, ...nodeTexts(node).filter((text) => text.self)];
}

/** The names the node reads in the texts it uses (`textsInUse`), each with its path, in order. */
export function nodeReads(node: FlowNode): NodeRead[] {
	const reader = { node: node.id };
	return textsInUse(node).flatMap((text) => readsIn(reader, text));
}

/**
 * What the flow reads, in order: the texts each node uses (`nodeReads`),
 * the flow's outputs, and the initial values of its variables.
 */
export function flowReads(flow: Flow): FlowRead[] {
	const template = (reader: Reader, text: string): FlowRead[] =>
		templateRefs(text).map(({ name, path }) => ({
			reader,
			name,
			path,
			self: false,
			rule: false,
		}));
	return [
		...flow.nodes.flatMap(nodeReads),
		...flow.outputs.flatMap((output) =>
			template({ output: output.name }, output.value),
		),
		...(flow.variables ?? []).flatMap((variable) =>
			variable.initial === undefined
				? []
				: template({ variable: variable.name }, variable.initial),
		),
	];
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
 * the rules and the variable writes each node uses (`nodeReads`). Only
 * nodes of the flow count, not inputs, `vars` or `run`. A node that reads
 * itself has no link.
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
