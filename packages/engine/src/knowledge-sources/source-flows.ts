import {
	type Flow,
	flowNameSchema,
	flowSchema,
	KNOWLEDGE_FOLDER_INPUT,
	type KnowledgeSource,
	type KnowledgeSourceKit,
	knowledgeKitInputs,
	knowledgeSourceBracesProblem,
	knowledgeSourceKind,
	knowledgeSourceKitSchema,
	type Schedule,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { isLearningsFolder } from "../knowledge";

/**
 * A source's flow and schedule, as pure rules over a project's flows: a
 * source IS a flow (ADR 4, decision 6), one Subflow node that calls a
 * `kit:knowledge/*` kit with the person's values. `sources.ts` applies
 * them to the Space.
 */

/** The project's flows by name, null for one that is not valid. */
export type FlowMap = Readonly<Record<string, Flow | null>>;

/** What the knowledge kits' names start with. */
const KNOWLEDGE_KITS = "kit:knowledge/";

/**
 * Whether a source's schedule is this one: the source's own cron schedule.
 * Its webhook schedules are the flow's, not the source's.
 */
export function isSourceSchedule(schedule: Schedule, name: string): boolean {
	return schedule.flow === name && schedule.cron !== undefined;
}

/**
 * What the kits write their folders inside: the knowledge (`$NS_KNOWLEDGE`).
 * The kits refuse the same folders (`KNOWLEDGE_DEST`).
 */
function folderProblem(folder: string): string | null {
	const parts = folder.split("/");
	if (
		folder === "" ||
		folder.startsWith("/") ||
		parts.includes("..") ||
		isLearningsFolder(folder)
	) {
		return "Choose a folder inside the knowledge, for example docs. learnings is Night Shift's own.";
	}
	return null;
}

/**
 * The source's values the kit takes: trimmed, the empty ones left out (so
 * they take the kit's default). Refuses a name the kit does not take, a
 * required value that is missing, a value with `{{` (its flow would not
 * be a source any more) and a folder outside the knowledge.
 */
function checkedInputs(source: KnowledgeSource): Record<string, string> {
	const declared = knowledgeKitInputs(source.kit);
	const braces = knowledgeSourceBracesProblem(source);
	if (braces) throw new Refusal("invalid", braces);
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
	const folder = inputs[KNOWLEDGE_FOLDER_INPUT];
	const problem = folder === undefined ? null : folderProblem(folder);
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
export function sourceOf(flow: Flow): KnowledgeSource | null {
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

/**
 * The folders in the knowledge that a flow's knowledge kits fill: a
 * plain value of the `folder` input, else the kit's default. A folder a
 * template picks at run time is unknown, and left out.
 */
export function foldersOf(flow: Flow): string[] {
	const folders = new Set<string>();
	for (const node of flow.nodes) {
		if (node.type !== "call" || !node.flow.startsWith(KNOWLEDGE_KITS)) {
			continue;
		}
		const bound = node.inputs[KNOWLEDGE_FOLDER_INPUT];
		const folder =
			bound !== undefined
				? bound
				: knowledgeKitInputs(node.flow).find(
						(input) => input.name === KNOWLEDGE_FOLDER_INPUT,
					)?.default;
		if (folder !== undefined && folder !== "" && !folder.includes("{{")) {
			folders.add(folder);
		}
	}
	return [...folders].sort();
}

/** The folders the project's flows but `name` fill: a source never shares one. */
export function foldersOthersFill(flows: FlowMap, name?: string): Set<string> {
	return new Set(
		Object.entries(flows).flatMap(([other, flow]) =>
			other === name || !flow ? [] : foldersOf(flow),
		),
	);
}

/** `base`, else `base-2`, `base-3`…, whichever `taken` does not have. */
function free(base: string, taken: ReadonlySet<string>): string {
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const name = `${base}-${n}`;
		if (!taken.has(name)) return name;
	}
}

/**
 * The flow to save for a source, and its name: a new one (`name` unset)
 * gets a free name after its kind ("knowledge-web-pages", then "-2"). Its
 * folder in the knowledge is its own: a new source without one gets the
 * kit's folder, else a free one beside it, and an edited one keeps its
 * own. A folder another flow fills is refused, because each sync replaces
 * its folder.
 */
export function savedSource(input: {
	source: KnowledgeSource;
	name?: string;
	flows: FlowMap;
}): { name: string; flow: Flow } {
	const { source, name, flows } = input;
	const inputs = checkedInputs(source);
	let current: KnowledgeSource | null = null;
	if (name !== undefined) {
		const flow = flows[name];
		current = flow ? sourceOf(flow) : null;
		if (!current) {
			throw new Refusal(
				"not-found",
				"This project has no such source. It may have been removed.",
			);
		}
	}
	const others = foldersOthersFill(flows, name);
	const wanted = inputs[KNOWLEDGE_FOLDER_INPUT];
	if (wanted !== undefined) {
		if (others.has(wanted)) {
			throw new Refusal(
				"conflict",
				`Another source fills the folder ${wanted}. Choose another folder.`,
			);
		}
	} else {
		const kept =
			current?.kit === source.kit
				? current.inputs[KNOWLEDGE_FOLDER_INPUT]
				: undefined;
		const base =
			kept ??
			knowledgeKitInputs(source.kit).find(
				(input) => input.name === KNOWLEDGE_FOLDER_INPUT,
			)?.default ??
			"knowledge";
		inputs[KNOWLEDGE_FOLDER_INPUT] =
			kept !== undefined && !others.has(kept) ? kept : free(base, others);
	}
	const saved =
		name ??
		free(knowledgeSourceKind(source.kit).flowName, new Set(Object.keys(flows)));
	flowNameSchema.parse(saved);
	return { name: saved, flow: sourceFlow(source.kit, inputs) };
}

/**
 * The project's schedules with the source's own (`isSourceSchedule`) set
 * to `times` (added when it has none, with a free id), or removed with
 * `null`. Its webhook schedules and the other flows' stay as they are.
 */
export function withSourceSchedule(
	schedules: readonly Schedule[],
	name: string,
	times: { cron: string; device?: string } | null,
): Schedule[] {
	const index = schedules.findIndex((schedule) =>
		isSourceSchedule(schedule, name),
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
