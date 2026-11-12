/**
 * The rewrite of a node's texts (`rewriteNodeTexts`) keeps its own list of
 * fields: the checks visit only the fields a node reads as it is set up
 * now, the rewrite every field. These tests hold the two together, so a
 * new field cannot be missed again:
 *
 * - every field of the node schema that can hold a template is rewritten,
 *   or listed below as plain text;
 * - every text the checks read as a template or a rule, the rewrite visits
 *   as one, with the same names of its own.
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { type FlowNode, flowSchema } from "../flow";
import { checkNodeWith } from "../validate";
import { rewriteNodeTexts, type TextField } from "./refs";

/** The schema of one node, of any type. */
const flowNodeSchema = flowSchema.shape.nodes.element;

type Json = { [key: string]: unknown };
type Text = { text: string; rule: boolean; also: readonly string[] };

/** A field of the schema that holds text, in any node of the type: `cascade[].inputs{}`. */
type Position = readonly string[];

const showPosition = (position: Position) =>
	position.reduce(
		(shown, key) =>
			key === "[]" || key === "{}"
				? shown + key
				: shown === ""
					? key
					: `${shown}.${key}`,
		"",
	);

/** A string field that is not one fixed word, and whose pattern takes a template. */
function holdsTemplate(schema: Json): boolean {
	return (
		schema.type === "string" &&
		schema.const === undefined &&
		schema.enum === undefined &&
		(typeof schema.pattern !== "string" ||
			new RegExp(schema.pattern).test("{{scout.data}}"))
	);
}

/** Per node type, every field that can hold a template, from the schema. */
function textPositions(): Map<string, Position[]> {
	const root = z.toJSONSchema(flowNodeSchema, {
		unrepresentable: "any",
		io: "input",
	}) as Json;
	const defs = (root.$defs ?? {}) as Record<string, Json>;
	const byType = new Map<string, Position[]>();
	for (const variant of root.oneOf as Json[]) {
		const properties = variant.properties as Record<string, Json>;
		const type = String(properties.type?.const);
		const found = new Map<string, Position>();
		const walk = (schema: Json, at: Position, seen: ReadonlySet<string>) => {
			const ref = schema.$ref;
			if (typeof ref === "string") {
				if (seen.has(ref)) return;
				const def = defs[ref.replace("#/$defs/", "")] ?? {};
				walk(def, at, new Set([...seen, ref]));
				return;
			}
			for (const key of ["anyOf", "oneOf", "allOf"]) {
				for (const branch of (schema[key] as Json[] | undefined) ?? [])
					walk(branch, at, seen);
			}
			if (holdsTemplate(schema)) found.set(showPosition(at), at);
			if (typeof schema.items === "object" && schema.items !== null)
				walk(schema.items as Json, [...at, "[]"], seen);
			const fields = (schema.properties ?? {}) as Record<string, Json>;
			for (const [key, field] of Object.entries(fields))
				walk(field, [...at, key], seen);
			if (
				typeof schema.additionalProperties === "object" &&
				schema.additionalProperties !== null
			)
				walk(schema.additionalProperties as Json, [...at, "{}"], seen);
		};
		walk(variant, [], new Set());
		byType.set(type, [...found.values()]);
	}
	return byType;
}

/** Plain text in every node type that has the field: names, models, places. */
const SHARED_PLAIN = new Set([
	"label",
	"device",
	"device.name",
	"profile.device",
	"profile.profile",
	"fallbacks[].device",
	"fallbacks[].profile",
	"model",
	"address.baseUrl",
	"address.headers{}",
	"cascade[].label",
	"cascade[].model",
	"cascade[].profile.device",
	"cascade[].profile.profile",
	"cascade[].address.baseUrl",
	"cascade[].address.headers{}",
]);

/**
 * The fields of a node type that hold plain text, not a template, and no
 * rule that reads the flow. A rule over `event` or `data` only (a Wait's
 * outcome, a Value tier's `accept`) is plain here: it names nothing of
 * the flow. An Agent's outcome takes no rule (Decision options only).
 */
const PLAIN: Record<string, readonly string[]> = {
	agent: ["skill", "outcomes[].description", "outcomes[].when", "knowledge[]"],
	command: ["exits[].description"],
	decision: ["options[].description"],
	value: [
		"choices.field",
		"attachments[].label",
		"default",
		"cascade[].accept",
	],
	wait: ["outcomes[].description", "outcomes[].when"],
	tool: ["tool"],
	lease: ["scope.section"],
	service: ["scope.section"],
	"since-last-run": ["key", "compare[]"],
	convert: ["delimiter"],
	"web-request": ["body.contentType"],
};

let count = 0;
/** A template no other field of the fixtures holds. */
const template = (before = "") => `${before}{{n${++count}.data}}`;
/** A rule no other field of the fixtures holds. */
const rule = () => `n${++count}.data = 1`;
/** Plain text no other field of the fixtures holds. */
const plain = () => `p${++count}`;

const personTier = (choose: string) => ({
	person: true,
	label: plain(),
	deadline: { at: template(), choose },
	urgency: template(),
	situation: template(),
	background: template(),
	recommend: { option: template(), reason: template() },
});

/** Each node type set up in each way, every field that holds text set. */
const FIXTURES: FlowNode[] = [
	{
		type: "agent",
		prompt: template(),
		skill: plain(),
		check: template("test -n "),
		outcomes: [{ name: "done", description: plain(), when: plain() }],
		knowledge: [plain()],
		cascade: [{ model: plain() }, personTier("stop")],
	},
	{
		type: "command",
		command: template(),
		exits: [{ name: "none", code: 1, description: plain() }],
	},
	{
		type: "decision",
		by: "person",
		prompt: template(),
		title: template(),
		deadline: { at: template(), choose: "go" },
		urgency: template(),
		situation: template(),
		background: template(),
		recommend: { option: template(), reason: template() },
		options: [
			{ name: "go", description: plain(), impact: template() },
			{ name: "stop", impact: template() },
		],
	},
	{
		type: "decision",
		by: "rule",
		prompt: "",
		options: [{ name: "go", when: rule() }, { name: "stop" }],
	},
	{
		type: "decision",
		by: "model",
		prompt: template(),
		options: [{ name: "go", impact: template() }, { name: "stop" }],
		cascade: [{ model: plain() }, personTier("go")],
	},
	{
		type: "call",
		flow: "research",
		inputs: { topic: template() },
		each: { source: { kind: "json", value: template() } },
	},
	{
		type: "call",
		flow: "research",
		each: { source: { kind: "command", command: template() } },
	},
	{
		type: "call",
		flow: "research",
		cascade: [
			{ flow: "deep", inputs: { topic: template() } },
			personTier("stop"),
		],
	},
	{
		type: "value",
		by: "person",
		prompt: template(),
		title: template(),
		urgency: template(),
		situation: template(),
		background: template(),
		output: { type: "object", properties: { pick: { type: "string" } } },
		choices: { from: template(), field: plain() },
		attachments: [{ path: template(), label: plain() }, { url: template() }],
		deadline: { at: template() },
		default: plain(),
	},
	{
		type: "value",
		by: "rule",
		output: { type: "object" },
		expression: rule(),
	},
	{
		type: "value",
		by: "model",
		prompt: template(),
		output: { type: "object" },
		cascade: [{ model: plain(), accept: plain() }, personTier("accept")],
	},
	{ type: "wait", until: { kind: "time", at: template() } },
	{
		type: "wait",
		until: { kind: "command", command: template(), everyMinutes: 1 },
		outcomes: [{ name: "ready", description: plain() }],
	},
	{
		type: "wait",
		until: { kind: "signal", name: "paid", key: template() },
		outcomes: [{ name: "ready", when: plain() }],
	},
	{
		type: "wait",
		until: {
			kind: "any",
			signal: { name: "paid", key: template() },
			command: { command: template(), everyMinutes: 1 },
		},
	},
	{
		type: "wait",
		until: {
			kind: "url",
			url: template(),
			everyMinutes: 1,
			headers: { Accept: template() },
		},
	},
	{
		type: "tool",
		connection: "search",
		tool: plain(),
		arguments: { query: template() },
	},
	{
		type: "end",
		status: "done",
		message: template(),
		report: { kind: "text", text: template() },
	},
	{ type: "join" },
	{ type: "lease", name: template(), scope: { section: plain() } },
	{
		type: "service",
		start: template(),
		ready: { command: template(), url: template() },
		stop: template(),
		scope: { section: plain() },
	},
	{
		type: "since-last-run",
		items: template(),
		key: plain(),
		compare: [plain()],
		scope: template(),
	},
	{ type: "since-last-run", value: template(), when: rule() },
	{
		type: "convert",
		from: "csv",
		to: "json",
		value: template(),
		delimiter: ";",
	},
	{
		type: "web-request",
		method: "POST",
		url: template(),
		query: { q: template() },
		headers: { "X-Topic": template() },
		body: { kind: "json", value: template() },
	},
	{
		type: "web-request",
		method: "POST",
		urlSecret: template(),
		body: { kind: "form", fields: { topic: template() } },
	},
	{
		type: "web-request",
		method: "POST",
		url: template(),
		body: { kind: "text", value: template(), contentType: plain() },
	},
].map((fields, index) =>
	flowNodeSchema.parse({
		id: `node_${index}`,
		position: { x: 0, y: 0 },
		set: [{ variable: "v", value: template(), expression: rule() }],
		...fields,
	}),
);

/** The texts the checks of the node read as templates and rules. */
function checkedTexts(node: FlowNode): Text[] {
	const texts: Text[] = [];
	const read = (text: string) => {
		texts.push({ text, rule: false, also: [] });
	};
	const skip = () => {};
	checkNodeWith(node, {
		error: skip,
		warning: skip,
		template: read,
		commandTemplate: read,
		rule: (text, _subject, also = []) => {
			texts.push({ text, rule: true, also });
		},
		eventRule: skip,
		dataRule: skip,
		routed: () => true,
		section: () => null,
	});
	return texts;
}

/** The texts the rewrite visits. */
function rewrittenTexts(node: FlowNode): (TextField & { text: string })[] {
	const texts: (TextField & { text: string })[] = [];
	rewriteNodeTexts(node, (text, field) => {
		texts.push({ text, ...field });
		return text;
	});
	return texts;
}

/** Every text of a value that is not empty, with where it sits. */
function leaves(
	value: unknown,
	at: Position = [],
): { at: Position; text: string }[] {
	if (typeof value === "string")
		return value === "" ? [] : [{ at, text: value }];
	if (Array.isArray(value))
		return value.flatMap((item) => leaves(item, [...at, "[]"]));
	if (typeof value !== "object" || value === null) return [];
	return Object.entries(value).flatMap(([key, item]) =>
		leaves(item, [...at, key]),
	);
}

/** The text sits in the field: `{}` takes any key of a record. */
const sitsIn = (at: Position, position: Position) =>
	at.length === position.length &&
	position.every(
		(key, index) => key === at[index] || (key === "{}" && at[index] !== "[]"),
	);

describe("the rewrite of a node's texts", () => {
	const positions = textPositions();

	test("every node type has fields that hold text", () => {
		const types = flowNodeSchema.options.map(
			(option) => option.shape.type.value,
		);
		expect([...positions.keys()].sort()).toEqual([...types].sort());
	});

	test.each([...positions.keys()])(
		"every field of %s that can hold a template is rewritten, or plain",
		(type) => {
			const fixtures = FIXTURES.filter((node) => node.type === type);
			const problems: string[] = [];
			for (const position of positions.get(type) ?? []) {
				const shown = showPosition(position);
				if (SHARED_PLAIN.has(shown)) continue;
				const plainField = PLAIN[type]?.includes(shown) ?? false;
				const texts = fixtures.flatMap((node) =>
					leaves(node)
						.filter((leaf) => sitsIn(leaf.at, position))
						.map((leaf) => ({ node, text: leaf.text })),
				);
				if (texts.length === 0) {
					problems.push(`${shown}: no fixture sets it`);
					continue;
				}
				for (const { node, text } of texts) {
					const rewritten = rewrittenTexts(node).some((t) => t.text === text);
					const checked = checkedTexts(node).some((t) => t.text === text);
					if (plainField && (rewritten || checked))
						problems.push(`${shown}: listed as plain, but it is read`);
					if (!plainField && !rewritten)
						problems.push(`${shown}: the rewrite skips it`);
				}
			}
			expect(problems).toEqual([]);
		},
	);

	test.each(FIXTURES.map((node) => [node.id, node.type, node] as const))(
		"the rewrite visits every text the checks read (%s, %s)",
		(_id, _type, node) => {
			const rewritten = rewrittenTexts(node);
			const missed = checkedTexts(node).filter(
				(checked) =>
					!rewritten.some(
						(text) =>
							text.text === checked.text &&
							text.rule === checked.rule &&
							text.also.join() === checked.also.join(),
					),
			);
			expect(missed).toEqual([]);
		},
	);
});
