/**
 * The texts a node holds, as its type declares them
 * (`NodeDefinition.texts`), against the two other places that know them:
 *
 * - the flow schema: each string field that can hold a template is a
 *   declared text or a declared plain field, once, and nothing else is;
 * - the check: each text it reads as a template, a command or a rule is a
 *   declared text of that kind, with the same own names. The check reads
 *   only the texts in use, so it may read fewer.
 *
 * A rename, the reads, Make subflow, a paste and the command checks visit
 * the declared texts (`nodeTexts`), so a new field is one line in its node
 * file, and these tests fail until it is there.
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { type NodeCheck, nodeBasePlain, nodeBaseTexts } from "../nodes/base";
import { type NodeText, type TextKind, textsIn } from "../nodes/texts";
import { checkNodeWith } from "../validate";
import { type FlowNode, type FlowNodeType, flowNodeSchema } from "./flow";
import { NODE_DEFINITIONS, nodeTexts } from "./node";

type Json = { [key: string]: unknown };

const TYPES = Object.keys(NODE_DEFINITIONS) as FlowNodeType[];

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

/**
 * Per node type, every field of the schema that can hold a template, in
 * the notation of `NodeText.at`: `cascade[].inputs{}`.
 */
function schemaPositions(): Map<string, string[]> {
	const root = z.toJSONSchema(flowNodeSchema, {
		unrepresentable: "any",
		io: "input",
	}) as Json;
	const defs = (root.$defs ?? {}) as Record<string, Json>;
	const byType = new Map<string, string[]>();
	for (const variant of root.oneOf as Json[]) {
		const properties = variant.properties as Record<string, Json>;
		const found = new Set<string>();
		const walk = (schema: Json, at: string, seen: ReadonlySet<string>) => {
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
			if (holdsTemplate(schema)) found.add(at);
			if (typeof schema.items === "object" && schema.items !== null)
				walk(schema.items as Json, `${at}[]`, seen);
			const fields = (schema.properties ?? {}) as Record<string, Json>;
			for (const [key, field] of Object.entries(fields))
				walk(field, at === "" ? key : `${at}.${key}`, seen);
			if (
				typeof schema.additionalProperties === "object" &&
				schema.additionalProperties !== null
			)
				walk(schema.additionalProperties as Json, `${at}{}`, seen);
		};
		walk(variant, "", new Set());
		byType.set(String(properties.type?.const), [...found]);
	}
	return byType;
}

/** Every position a type declares: its texts and plain fields, and those of every node. */
function declared(type: FlowNodeType): string[] {
	const definition = NODE_DEFINITIONS[type];
	return [
		...definition.texts.map((text) => text.at),
		...nodeBaseTexts.map((text) => text.at),
		...definition.plain,
		...nodeBasePlain,
	];
}

/**
 * Plain text in every type that has the field: names, models, places.
 * The fixtures need not set them.
 */
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
	{
		type: "end",
		status: "done",
		report: { kind: "file", path: template("reports/") },
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

/** A text as the check reads it. */
type CheckedText = { text: string; kind: TextKind; also: readonly string[] };

/** The texts the check of the node reads as templates, commands and rules. */
function checkedTexts(node: FlowNode): CheckedText[] {
	const texts: CheckedText[] = [];
	const read =
		(kind: TextKind) =>
		(text: string): void => {
			texts.push({ text, kind, also: [] });
		};
	const skip = () => {};
	const check: NodeCheck = {
		error: skip,
		warning: skip,
		template: read("template"),
		commandTemplate: read("command"),
		rule: (text, _subject, also = []) => {
			texts.push({ text, kind: "rule", also });
		},
		// These read only `event` or `data`: plain text.
		eventRule: skip,
		dataRule: skip,
		routed: () => true,
		section: () => null,
	};
	checkNodeWith(node, check);
	return texts;
}

/** The positions of a node that hold a text that is not empty: its texts and its plain fields. */
function setPositions(node: FlowNode): string[] {
	const plain: NodeText[] = [
		...NODE_DEFINITIONS[node.type].plain,
		...nodeBasePlain,
	].map((at) => ({ at }));
	return [...nodeTexts(node), ...textsIn(node, plain)]
		.filter((text) => text.text !== "")
		.map((text) => text.at);
}

describe("the texts a node type declares", () => {
	const positions = schemaPositions();

	test("the schema has the node types of the definitions", () => {
		expect([...positions.keys()].sort()).toEqual([...TYPES].sort());
	});

	test.each(TYPES)(
		"%s names each field of its schema that can hold a template once, as a text or as plain text",
		(type) => {
			const own = declared(type);
			expect(own.filter((at, index) => own.indexOf(at) !== index)).toEqual([]);
			expect([...own].sort()).toEqual([...(positions.get(type) ?? [])].sort());
		},
	);

	test.each(TYPES)(
		"the fixtures of %s set each text and each plain field it declares",
		(type) => {
			const set = new Set(
				FIXTURES.filter((node) => node.type === type).flatMap(setPositions),
			);
			const unset = declared(type).filter(
				(at) => !SHARED_PLAIN.has(at) && !set.has(at),
			);
			expect(unset).toEqual([]);
		},
	);

	test.each(FIXTURES.map((node) => [node.id, node.type, node] as const))(
		"the check of %s (%s) reads only declared texts, each as its kind",
		(_id, _type, node) => {
			const held = nodeTexts(node);
			const undeclared = checkedTexts(node).filter(
				(checked) =>
					!held.some(
						(text) =>
							text.text === checked.text &&
							text.kind === checked.kind &&
							text.also.join() === checked.also.join(),
					),
			);
			expect(undeclared).toEqual([]);
		},
	);
});
