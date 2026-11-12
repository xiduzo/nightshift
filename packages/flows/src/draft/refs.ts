/** Renames in templates, rules and expressions. */
import type { Flow, FlowNode } from "../flow";
import {
	type GateBriefFields,
	isPersonTier,
	type ListSource,
	type PersonTier,
	type WaitNode,
	type WebRequestNode,
} from "../nodes";
import type { TemplateRef } from "../template";
import { rewriteRuleNames, templateRefs } from "../template";

/** A name a template can reference: a node id, an input, `run` or `vars`. */
const REF_NAME = /^[a-z][a-z0-9_]*$/;
/** A key of a reference's path. */
const REF_KEY = /^[A-Za-z0-9_-]+$/;

/**
 * Rewrites the references in a template that `rename` gives a new text for.
 * Everything else stays as it is.
 */
export function rewriteRefs(
	text: string,
	rename: (ref: TemplateRef) => string | undefined,
): string {
	let out = "";
	let cursor = 0;
	for (const ref of templateRefs(text)) {
		// The references come in order and do not overlap.
		const at = text.indexOf(ref.raw, cursor);
		out += text.slice(cursor, at) + (rename(ref) ?? ref.raw);
		cursor = at + ref.raw.length;
	}
	return out + text.slice(cursor);
}

/**
 * The rewrite for a name that no template can reference. The editor passes
 * only valid names. For any other name, the result stays as it was before
 * the rewrite used `templateRefs`: `from` goes into the pattern as it is.
 */
function rewriteByPattern(
	text: string,
	prefix: string,
	from: string,
	to: string,
): string {
	const reference = new RegExp(
		`(\\{\\{\\s*${prefix})${from}(?=(?:\\.[A-Za-z0-9_-]+)*\\s*\\}\\})`,
		"g",
	);
	return text.replace(reference, `$1${to}`);
}

/**
 * Rewrites the references to `from` in a template: `{{from}}`,
 * `{{ from.path.to }}`. Other names that start the same stay.
 */
export function renameRefs(text: string, from: string, to: string): string {
	if (!REF_NAME.test(from)) return rewriteByPattern(text, "", from, to);
	return rewriteRefs(text, (ref) => {
		if (ref.name !== from) return undefined;
		const at = ref.raw.indexOf(from);
		return ref.raw.slice(0, at) + to + ref.raw.slice(at + from.length);
	});
}

/**
 * Rewrites the references to the variable `from` in a template:
 * `{{vars.from}}`, `{{ vars.from.path }}`.
 */
export function renameVarRefs(text: string, from: string, to: string): string {
	if (!REF_KEY.test(from)) return rewriteByPattern(text, "vars\\.", from, to);
	return rewriteRefs(text, (ref) => {
		if (ref.name !== "vars" || ref.path[0] !== from) return undefined;
		const at = ref.raw.indexOf("vars") + "vars.".length;
		return ref.raw.slice(0, at) + to + ref.raw.slice(at + from.length);
	});
}

/**
 * Rewrites the name `from` where a rule or an expression reads it at the
 * top: `from.data.x`, `` `from`.data ``. A string, a `$` variable, a key
 * below another name and the rule's own names (`also`: `previous`,
 * `current`) stay. A rule that is not valid stays as it is.
 */
function renameInRule(
	text: string,
	from: string,
	to: string,
	also: readonly string[] = [],
): string {
	if (also.includes(from)) return text;
	return rewriteRuleNames(text, (name) => (name === from ? to : undefined));
}

/**
 * Renames `from` in every template and rule of the flow
 * (`rewriteFlowTexts`): `{{from…}}` in a template, `from` at the top of a
 * rule.
 */
export function renameInFlow(flow: Flow, from: string, to: string): Flow {
	return rewriteFlowTexts(flow, (text, field) =>
		field.rule
			? renameInRule(text, from, to, field.also)
			: renameRefs(text, from, to),
	);
}

/**
 * Rewrites `vars.from` in a rule or an expression, best effort: a name
 * that only starts the same (`vars.from_2`) stays.
 */
export function renameVarInRule(
	text: string,
	from: string,
	to: string,
): string {
	const reference = new RegExp(
		`(^|[^A-Za-z0-9_$.])(vars\\.)${from}(?![A-Za-z0-9_])`,
		"g",
	);
	return text.replace(reference, `$1$2${to}`);
}

/**
 * Renames a variable, its `{{vars.old…}}` references in this flow's
 * templates, `vars.old` in its rules and expressions, and the writes to it.
 */
export function renameVariable(flow: Flow, index: number, to: string): Flow {
	const from = flow.variables?.[index]?.name;
	if (from === undefined || from === to) return flow;
	const renamed = rewriteFlowTexts(flow, (text, field) =>
		field.rule
			? renameVarInRule(text, from, to)
			: renameVarRefs(text, from, to),
	);
	return {
		...renamed,
		nodes: renamed.nodes.map((node) =>
			node.set === undefined
				? node
				: {
						...node,
						set: node.set.map((write) =>
							write.variable === from ? { ...write, variable: to } : write,
						),
					},
		),
		variables: (renamed.variables ?? []).map((variable, at) =>
			at === index ? { ...variable, name: to } : variable,
		),
	};
}

/**
 * Renames an input, the `{{old…}}` references in this flow's nodes and
 * outputs, and `old` where its rules read it. Flows that call this one
 * keep binding the old name.
 */
export function renameInput(flow: Flow, index: number, to: string): Flow {
	const from = flow.inputs[index]?.name;
	if (from === undefined || from === to) return flow;
	const next = renameInFlow(flow, from, to);
	return {
		...next,
		inputs: next.inputs.map((input, at) =>
			at === index ? { ...input, name: to } : input,
		),
	};
}

/**
 * A text of a node that can read a name. A template reads names in
 * `{{…}}`. A rule (JSONata) reads them bare, and `also` lists the names
 * it reads besides the flow's (`previous`, `current`). `self`: a variable
 * write's value or expression, where the node's id reads the step that
 * just ended.
 */
export type TextField = {
	rule: boolean;
	also: readonly string[];
	self: boolean;
};

/** The new text of one text of a node. */
export type TextRewrite = (text: string, field: TextField) => string;

const TEMPLATE: TextField = { rule: false, also: [], self: false };

/** The names a Since last run rule reads besides the flow's. */
const SINCE_LAST_RUN_NAMES = ["previous", "current"] as const;

/** How the walk of one node rewrites its own templates and rules. */
type OwnTexts = {
	template: (text: string) => string;
	rule: (text: string, also?: readonly string[]) => string;
};

function rewriteBindings(
	bindings: Record<string, string>,
	rewrite: (text: string) => string,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(bindings).map(([name, value]) => [name, rewrite(value)]),
	);
}

/** A Web request's templates: its URL, its URL secret, its query, headers and body. */
function rewriteWebRequest(
	node: WebRequestNode,
	rewrite: (text: string) => string,
): WebRequestNode {
	const { url, urlSecret, query, headers, body } = node;
	return {
		...node,
		...(url === undefined ? {} : { url: rewrite(url) }),
		...(urlSecret === undefined ? {} : { urlSecret: rewrite(urlSecret) }),
		...(query === undefined ? {} : { query: rewriteBindings(query, rewrite) }),
		...(headers === undefined
			? {}
			: { headers: rewriteBindings(headers, rewrite) }),
		...(body === undefined
			? {}
			: {
					body:
						body.kind === "form"
							? { ...body, fields: rewriteBindings(body.fields, rewrite) }
							: { ...body, value: rewrite(body.value) },
				}),
	};
}

function rewriteSource(
	source: ListSource,
	rewrite: (text: string) => string,
): ListSource {
	switch (source.kind) {
		case "json":
			return { ...source, value: rewrite(source.value) };
		case "command":
			return { ...source, command: rewrite(source.command) };
	}
}

/** The brief fields of a Gate's node with their templates rewritten: only the fields it sets. */
function rewriteBrief(
	node: GateBriefFields,
	rewrite: (text: string) => string,
): GateBriefFields {
	const { urgency, situation, background, recommend } = node;
	return {
		...(urgency === undefined ? {} : { urgency: rewrite(urgency) }),
		...(situation === undefined ? {} : { situation: rewrite(situation) }),
		...(background === undefined ? {} : { background: rewrite(background) }),
		...(recommend === undefined
			? {}
			: {
					recommend: {
						...recommend,
						option: rewrite(recommend.option),
						...(recommend.reason === undefined
							? {}
							: { reason: rewrite(recommend.reason) }),
					},
				}),
	};
}

/** A deadline of a Gate or an Ask: its time, when it has one. */
function rewriteDeadline<T extends { at?: string }>(
	deadline: T,
	rewrite: (text: string) => string,
): T {
	return deadline.at === undefined
		? deadline
		: { ...deadline, at: rewrite(deadline.at) };
}

/**
 * A cascade: the deadline and the brief of its person tier, and the
 * templates `own` finds in each other tier.
 */
function rewriteCascade<T extends object>(
	tiers: readonly (T | PersonTier)[],
	rewrite: (text: string) => string,
	own: (tier: T) => T = (tier) => tier,
): (T | PersonTier)[] {
	return tiers.map((tier) =>
		isPersonTier(tier)
			? {
					...tier,
					...(tier.deadline === undefined
						? {}
						: { deadline: rewriteDeadline(tier.deadline, rewrite) }),
					...rewriteBrief(tier, rewrite),
				}
			: own(tier),
	);
}

/** What a Wait waits for: its time, its command, its signal's key, its URL and headers. */
function rewriteUntil(
	until: WaitNode["until"],
	rewrite: (text: string) => string,
): WaitNode["until"] {
	switch (until.kind) {
		case "duration":
			return until;
		case "time":
			return { ...until, at: rewrite(until.at) };
		case "command":
			return { ...until, command: rewrite(until.command) };
		case "signal":
			return until.key === undefined
				? until
				: { ...until, key: rewrite(until.key) };
		case "any": {
			const { signal, command } = until;
			return {
				...until,
				signal:
					signal.key === undefined
						? signal
						: { ...signal, key: rewrite(signal.key) },
				command: { ...command, command: rewrite(command.command) },
			};
		}
		case "url":
			return {
				...until,
				url: rewrite(until.url),
				...(until.headers
					? { headers: rewriteBindings(until.headers, rewrite) }
					: {}),
			};
	}
}

/**
 * Applies `rewrite` to every text of the node that can read a name: its
 * templates and its rules, then the value and the expression of each
 * variable write. A field the node does not read as it is set up now
 * counts too (the Ask fields of a Value a model makes): set up again, it
 * reads the new names. So this is not the walk of the checks
 * (`checkNodeWith`), which read only the fields in use. Every text the
 * checks read is one of these: `refs-fields.test.ts` holds the two
 * together, and fails on a field of the schema that is in neither list.
 * Rules that read only `event` or `data` (a Wait's outcomes, a cascade
 * tier's `accept`) read no name of the flow: they stay.
 */
export function rewriteNodeTexts(
	node: FlowNode,
	rewrite: TextRewrite,
): FlowNode {
	const own = rewriteOwnTexts(node, {
		template: (text) => rewrite(text, TEMPLATE),
		rule: (text, also = []) => rewrite(text, { rule: true, also, self: false }),
	});
	if (!own.set) return own;
	return {
		...own,
		set: own.set.map((write) => ({
			...write,
			...(write.value === undefined
				? {}
				: {
						value: rewrite(write.value, { rule: false, also: [], self: true }),
					}),
			...(write.expression === undefined
				? {}
				: {
						expression: rewrite(write.expression, {
							rule: true,
							also: [],
							self: true,
						}),
					}),
		})),
	};
}

/** Applies `rewrite` to every template of the node: `rewriteNodeTexts` without the rules. */
export function rewriteTemplates(
	node: FlowNode,
	rewrite: (text: string) => string,
): FlowNode {
	return rewriteNodeTexts(node, (text, field) =>
		field.rule ? text : rewrite(text),
	);
}

/** The templates and rules of the node's own kind: all but its variable writes. */
function rewriteOwnTexts(
	node: FlowNode,
	{ template, rule }: OwnTexts,
): FlowNode {
	switch (node.type) {
		case "agent":
			return {
				...node,
				prompt: template(node.prompt),
				...(node.check === undefined ? {} : { check: template(node.check) }),
				...(node.cascade === undefined
					? {}
					: { cascade: rewriteCascade(node.cascade, template) }),
			};
		case "decision":
			return {
				...node,
				prompt: template(node.prompt),
				...(node.deadline === undefined
					? {}
					: { deadline: rewriteDeadline(node.deadline, template) }),
				...rewriteBrief(node, template),
				options: node.options.map((option) => ({
					...option,
					...(option.impact === undefined
						? {}
						: { impact: template(option.impact) }),
					...(option.when === undefined ? {} : { when: rule(option.when) }),
				})),
				...(node.title === undefined ? {} : { title: template(node.title) }),
				...(node.cascade === undefined
					? {}
					: { cascade: rewriteCascade(node.cascade, template) }),
			};
		case "end":
			return {
				...node,
				...(node.message === undefined
					? {}
					: { message: template(node.message) }),
				...(node.report?.kind === "text"
					? { report: { ...node.report, text: template(node.report.text) } }
					: {}),
			};
		case "command":
			return { ...node, command: template(node.command) };
		case "call":
			return {
				...node,
				inputs: rewriteBindings(node.inputs, template),
				...(node.each
					? {
							each: {
								...node.each,
								source: rewriteSource(node.each.source, template),
							},
						}
					: {}),
				...(node.cascade === undefined
					? {}
					: {
							cascade: rewriteCascade(node.cascade, template, (tier) =>
								tier.inputs === undefined
									? tier
									: { ...tier, inputs: rewriteBindings(tier.inputs, template) },
							),
						}),
			};
		case "value": {
			const { choices, attachments, deadline } = node;
			return {
				...node,
				...(node.prompt === undefined ? {} : { prompt: template(node.prompt) }),
				...rewriteBrief(node, template),
				...(node.expression === undefined
					? {}
					: { expression: rule(node.expression) }),
				...(node.title === undefined ? {} : { title: template(node.title) }),
				...(choices === undefined
					? {}
					: { choices: { ...choices, from: template(choices.from) } }),
				...(attachments === undefined
					? {}
					: {
							attachments: attachments.map((attachment) => ({
								...attachment,
								...(attachment.path === undefined
									? {}
									: { path: template(attachment.path) }),
								...(attachment.url === undefined
									? {}
									: { url: template(attachment.url) }),
							})),
						}),
				...(deadline === undefined
					? {}
					: { deadline: rewriteDeadline(deadline, template) }),
				...(node.cascade === undefined
					? {}
					: { cascade: rewriteCascade(node.cascade, template) }),
			};
		}
		case "wait":
			return { ...node, until: rewriteUntil(node.until, template) };
		case "tool":
			return { ...node, arguments: rewriteBindings(node.arguments, template) };
		case "convert":
			return { ...node, value: template(node.value) };
		case "join":
			return node;
		case "lease":
			return { ...node, name: template(node.name) };
		case "service":
			return {
				...node,
				start: template(node.start),
				ready: {
					...node.ready,
					...(node.ready.command !== undefined
						? { command: template(node.ready.command) }
						: {}),
					...(node.ready.url !== undefined
						? { url: template(node.ready.url) }
						: {}),
				},
				...(node.stop !== undefined ? { stop: template(node.stop) } : {}),
			};
		case "since-last-run":
			return {
				...node,
				...(node.items === undefined ? {} : { items: template(node.items) }),
				...(node.value === undefined ? {} : { value: template(node.value) }),
				...(node.scope === undefined ? {} : { scope: template(node.scope) }),
				...(node.when === undefined
					? {}
					: { when: rule(node.when, SINCE_LAST_RUN_NAMES) }),
			};
		case "web-request":
			return rewriteWebRequest(node, template);
	}
}

/**
 * Applies `rewrite` to every text of the flow that can read a name: its
 * nodes' (`rewriteNodeTexts`), its outputs, and the initial values of its
 * variables.
 */
export function rewriteFlowTexts(flow: Flow, rewrite: TextRewrite): Flow {
	const template = (text: string) => rewrite(text, TEMPLATE);
	const rewritten: Flow = {
		...flow,
		nodes: flow.nodes.map((node) => rewriteNodeTexts(node, rewrite)),
		outputs: flow.outputs.map((output) => ({
			...output,
			value: template(output.value),
		})),
	};
	if (!flow.variables) return rewritten;
	return {
		...rewritten,
		variables: flow.variables.map((variable) =>
			variable.initial === undefined
				? variable
				: { ...variable, initial: template(variable.initial) },
		),
	};
}
