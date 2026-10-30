import { Refusal } from "@nightshift/refusal";
import { z } from "zod";
import { type Flow, flowSchema } from "../../flow";
import { flowNameSchema, nameSchema } from "../../nodes";
import type { Schedule } from "../../schedules";
import { kitFlow } from "../kits";

/**
 * Knowledge sources: what a person adds on the Knowledge page. A source
 * IS a flow (ADR 4, decision 6): one Subflow node that calls a
 * `kit:knowledge/*` kit with the person's values, and a schedule of it
 * when it keeps itself up to date. No second store: the page reads the
 * flows back (`knowledgeSourceOf`).
 */

/** The kits a person adds as a source, in the order the page offers them. */
const SOURCE_KITS = [
	"kit:knowledge/folder",
	"kit:knowledge/files",
	"kit:knowledge/web",
	"kit:knowledge/github-wiki",
	"kit:knowledge/jira",
	"kit:knowledge/confluence",
] as const;

const knowledgeSourceKitSchema = z.enum(SOURCE_KITS);
export type KnowledgeSourceKit = z.infer<typeof knowledgeSourceKitSchema>;

/** One kind of source, as the page shows it and a new flow is named. */
export type KnowledgeSourceKind = {
	kit: KnowledgeSourceKit;
	/** What it fills the knowledge from, for a person: "Web pages". */
	label: string;
	/** The name of its first flow: a second gets `-2`. */
	flowName: string;
	/** The input that tells two sources of this kind apart: its value describes the source. */
	main: string;
	/** The inputs that take one value per line. */
	lines: readonly string[];
	/** It reads a folder of one computer: its runs belong on that Device. */
	local: boolean;
};

/** Every kind of source, in the order the page offers them. */
export const KNOWLEDGE_SOURCE_KINDS: readonly KnowledgeSourceKind[] = [
	{
		kit: "kit:knowledge/folder",
		label: "Folder on this computer",
		flowName: "knowledge-folder",
		main: "path",
		lines: ["patterns"],
		local: true,
	},
	{
		kit: "kit:knowledge/files",
		label: "Project files",
		flowName: "knowledge-project-files",
		main: "from",
		lines: ["from"],
		local: false,
	},
	{
		kit: "kit:knowledge/web",
		label: "Web pages",
		flowName: "knowledge-web-pages",
		main: "urls",
		lines: ["urls"],
		local: false,
	},
	{
		kit: "kit:knowledge/github-wiki",
		label: "GitHub wiki",
		flowName: "knowledge-github-wiki",
		main: "repo",
		lines: [],
		local: false,
	},
	{
		kit: "kit:knowledge/jira",
		label: "Jira",
		flowName: "knowledge-jira",
		main: "keys",
		lines: ["keys"],
		local: false,
	},
	{
		kit: "kit:knowledge/confluence",
		label: "Confluence",
		flowName: "knowledge-confluence",
		main: "pages",
		lines: ["pages"],
		local: false,
	},
];

/** The kind of a source kit. */
export function knowledgeSourceKind(
	kit: KnowledgeSourceKit,
): KnowledgeSourceKind {
	return KNOWLEDGE_SOURCE_KINDS.find(
		(kind) => kind.kit === kit,
	) as KnowledgeSourceKind;
}

/** A source as a person fills it in: the kit and its values, by input name. */
export const knowledgeSourceSchema = z.object({
	kit: knowledgeSourceKitSchema,
	inputs: z.record(nameSchema, z.string().max(20_000)),
});
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;

/** The input every knowledge kit has: its folder in the knowledge. */
const FOLDER_INPUT = "folder";

/**
 * What the kits write their folders inside: the knowledge (`$NS_KNOWLEDGE`).
 * The kits refuse the same folders (`KNOWLEDGE_DEST`).
 */
export function knowledgeFolderProblem(folder: string): string | null {
	const parts = folder.split("/");
	if (
		folder === "" ||
		folder.startsWith("/") ||
		parts.includes("..") ||
		parts[0] === "learnings"
	) {
		return "Choose a folder inside the knowledge, for example docs. learnings is Night Shift's own.";
	}
	return null;
}

/** The inputs a kit declares, by its name: none for a name that is not a kit. */
function kitInputs(kit: string) {
	return kitFlow(kit)?.inputs ?? [];
}

/**
 * The source's values the kit takes: trimmed, the empty ones left out (so
 * they take the kit's default). Refuses a name the kit does not take, a
 * required value that is missing and a folder outside the knowledge.
 */
function checkedInputs(source: KnowledgeSource): Record<string, string> {
	const declared = kitInputs(source.kit);
	const inputs: Record<string, string> = {};
	for (const [name, value] of Object.entries(source.inputs)) {
		if (!declared.some((input) => input.name === name)) {
			throw new Refusal("invalid", `This source has no field "${name}".`);
		}
		const text = value.trim();
		if (text !== "") inputs[name] = text;
	}
	const missing = declared.filter(
		(input) => input.required && !input.default && !inputs[input.name],
	);
	if (missing.length > 0) {
		throw new Refusal(
			"invalid",
			`Fill in ${missing.map((input) => input.label ?? input.name).join(", ")}.`,
		);
	}
	const folder = inputs[FOLDER_INPUT];
	const problem = folder === undefined ? null : knowledgeFolderProblem(folder);
	if (problem) throw new Refusal("invalid", problem);
	return inputs;
}

/** The flow of a source: one Subflow node that calls its kit with its values. */
function sourceFlow(kit: KnowledgeSourceKit, inputs: Record<string, string>) {
	const kind = knowledgeSourceKind(kit);
	return flowSchema.parse({
		version: 7,
		description: `Knowledge: ${kind.label}. Edit it on the Knowledge page.`,
		start: "sync",
		nodes: [
			{
				id: "sync",
				type: "call",
				label: kind.label,
				position: { x: 0, y: 0 },
				flow: kit,
				inputs,
			},
		],
		edges: [],
	});
}

/**
 * The source a flow is, when it is one the Knowledge page made: one
 * Subflow node that calls a source kit with plain values, nothing else.
 * Null for any other flow, also one that calls a knowledge kit among
 * other nodes: the page opens that one in the editor instead.
 */
export function knowledgeSourceOf(flow: Flow): KnowledgeSource | null {
	const [node, ...others] = flow.nodes;
	if (!node || others.length > 0 || flow.edges.length > 0) return null;
	if (node.type !== "call" || node.each !== undefined) return null;
	const kit = knowledgeSourceKitSchema.safeParse(node.flow);
	if (!kit.success) return null;
	if (Object.values(node.inputs).some((value) => value.includes("{{"))) {
		return null;
	}
	return { kit: kit.data, inputs: { ...node.inputs } };
}

/** What the knowledge kits' names start with. */
const KNOWLEDGE_KITS = "kit:knowledge/";

/**
 * The folders in the knowledge that a flow's knowledge kits fill: a
 * plain value of the `folder` input, else the kit's default. A folder a
 * template picks at run time is unknown, and left out.
 */
export function knowledgeFoldersOf(flow: Flow): string[] {
	const folders = new Set<string>();
	for (const node of flow.nodes) {
		if (node.type !== "call" || !node.flow.startsWith(KNOWLEDGE_KITS)) {
			continue;
		}
		const bound = node.inputs[FOLDER_INPUT];
		const folder =
			bound !== undefined
				? bound
				: kitInputs(node.flow).find((input) => input.name === FOLDER_INPUT)
						?.default;
		if (folder !== undefined && folder !== "" && !folder.includes("{{")) {
			folders.add(folder);
		}
	}
	return [...folders].sort();
}

/** `base`, else `base-2`, `base-3`…, whichever `taken` does not have. */
function free(base: string, taken: ReadonlySet<string>): string {
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const name = `${base}-${n}`;
		if (!taken.has(name)) return name;
	}
}

/** A source as it is saved: its flow's name and the flow. */
export type SavedKnowledgeSource = { name: string; flow: Flow };

/**
 * The flow to save for a source, and its name: a new one (`name` unset)
 * gets a free name after its kind ("knowledge-web-pages", then "-2"). Its
 * folder in the knowledge is its own: a new source without one gets the
 * kit's folder, else a free one beside it, and an edited one keeps its
 * own. A folder another flow fills is refused, because each sync replaces
 * its folder. `flows` are the project's flows by name, null for one that
 * is not valid.
 */
export function saveKnowledgeSource(input: {
	source: KnowledgeSource;
	name?: string;
	flows: Readonly<Record<string, Flow | null>>;
}): SavedKnowledgeSource {
	const { source, name, flows } = input;
	const declared = kitInputs(source.kit);
	const inputs = checkedInputs(source);
	let current: KnowledgeSource | null = null;
	if (name !== undefined) {
		const flow = flows[name];
		current = flow ? knowledgeSourceOf(flow) : null;
		if (!current) {
			throw new Refusal(
				"not-found",
				"This project has no such source. It may have been removed.",
			);
		}
	}
	const others = new Set(
		Object.entries(flows).flatMap(([other, flow]) =>
			other === name || !flow ? [] : knowledgeFoldersOf(flow),
		),
	);
	const wanted = inputs[FOLDER_INPUT];
	if (wanted !== undefined) {
		if (others.has(wanted)) {
			throw new Refusal(
				"conflict",
				`Another source fills the folder ${wanted}. Choose another folder.`,
			);
		}
	} else {
		const kept =
			current?.kit === source.kit ? current.inputs[FOLDER_INPUT] : undefined;
		const base =
			kept ??
			declared.find((input) => input.name === FOLDER_INPUT)?.default ??
			"knowledge";
		inputs[FOLDER_INPUT] =
			kept !== undefined && !others.has(kept) ? kept : free(base, others);
	}
	const saved =
		name ??
		free(knowledgeSourceKind(source.kit).flowName, new Set(Object.keys(flows)));
	flowNameSchema.parse(saved);
	return { name: saved, flow: sourceFlow(source.kit, inputs) };
}

/** When a source syncs on its own: a cron line, and the Device that runs it. */
export type KnowledgeSourceTimes = { cron: string; device?: string };

/**
 * The project's schedules with the source's own: its one cron schedule
 * set to `times` (added when it has none, with a free id), or removed
 * with `null`. Its webhook schedules and the other flows' stay as they are.
 */
export function withKnowledgeSourceSchedule(
	schedules: readonly Schedule[],
	name: string,
	times: KnowledgeSourceTimes | null,
): Schedule[] {
	const index = schedules.findIndex(
		(schedule) => schedule.flow === name && schedule.cron !== undefined,
	);
	if (times === null) {
		return schedules.filter((_, at) => at !== index);
	}
	const { device, ...cron } = times;
	const existing = index === -1 ? undefined : schedules[index];
	const { device: _old, ...kept } = existing ?? {
		id: free(name, new Set(schedules.map((schedule) => schedule.id))),
		flow: name,
		inputs: {},
		enabled: true,
	};
	const schedule: Schedule = {
		...kept,
		...cron,
		enabled: true,
		...(device !== undefined ? { device } : {}),
	};
	return index === -1
		? [...schedules, schedule]
		: schedules.map((other, at) => (at === index ? schedule : other));
}
