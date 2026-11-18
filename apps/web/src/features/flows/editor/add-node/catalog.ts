// What the node grid offers: every node a person can add, the Value
// presets and the kits, each in the family of its role.

import {
	kitList,
	NEW_NODE_TAKES,
	NODE_FAMILIES,
	NODE_FAMILY,
	NODE_FAMILY_LABEL,
	type NodeFamily,
	VALUE_PRESETS,
	type ValuePresetName,
} from "@nightshift/flows";
import {
	ArrowDownWideNarrowIcon,
	Columns3Icon,
	CopyMinusIcon,
	FunnelIcon,
	ListStartIcon,
	type LucideIcon,
} from "lucide-react";
import { NODE_TYPE, type PaletteItem, paletteMeta } from "../../canvas";

/**
 * Every palette item. A Decision shows twice, as the words people look
 * for: a Gate (you decide) and a Branch (a rule decides). A Decision by a
 * model is the same node, set in the inspector.
 */
const ITEMS: PaletteItem[] = [
	"agent",
	"command",
	"tool",
	"web-request",
	"gate",
	"branch",
	"value",
	"since-last-run",
	"convert",
	"wait",
	"lease",
	"service",
	"call",
	"join",
	"end",
];

/** The family of a palette item: a Gate and a Branch are Decisions. */
export function paletteFamily(item: PaletteItem): NodeFamily {
	return item === "gate" || item === "branch"
		? NODE_FAMILY.decision
		: NODE_FAMILY[item];
}

/** The palette items by family (`NODE_FAMILIES`): do, decide, shape, hold, compose. */
export const PALETTE: readonly PaletteItem[] = NODE_FAMILIES.flatMap((family) =>
	ITEMS.filter((item) => paletteFamily(item) === family),
);

/** Whether a new node starts from nothing or takes a value: the main output of the node it follows. */
export type Takes = "nothing" | "value";

/**
 * What picking an entry does: add a node, open the form of a Value preset,
 * or add a Subflow that runs a kit or a flow. A flow `from` another project
 * of the Space is copied into this one first.
 */
export type CatalogAdd =
	| { kind: "node"; item: PaletteItem }
	| { kind: "preset"; preset: ValuePresetName }
	| {
			kind: "kit";
			flow: string;
			from?: { projectId: string; project: string };
	  };

export type CatalogEntry = {
	/** Unique in the catalog. A drag onto the canvas carries it. */
	key: string;
	family: NodeFamily;
	takes: Takes;
	label: string;
	blurb: string;
	icon: LucideIcon;
	/** Other words people search for, so anyone finds the node. */
	keywords: readonly string[];
	/** A tag after the entry: "Kit", or the project a flow comes from. */
	badge?: string;
	/**
	 * It works in the project's folder: a kit that the registry marks, or a
	 * flow with a step that needs the folder (`folderNeeds`). A project
	 * without a folder cannot pick it (`offHere`).
	 */
	needsFolder?: true;
	add: CatalogAdd;
};

/** Why an entry cannot be picked in a project without a folder. */
export const NEEDS_FOLDER = "Needs a project with a folder.";

/**
 * Whether a project cannot pick the entry: it has no folder (`folder`
 * false) and the entry needs one.
 */
export function offHere(entry: CatalogEntry, folder: boolean): boolean {
	return !folder && entry.needsFolder === true;
}

/** The words people may search with for each node, past its name. */
const NODE_KEYWORDS: Record<PaletteItem, readonly string[]> = {
	agent: ["ai", "llm", "model", "assistant", "task", "prompt", "research"],
	command: ["shell", "script", "bash", "terminal", "cli", "program", "run"],
	tool: ["mcp", "server", "integration", "call"],
	"web-request": [
		"http",
		"api",
		"fetch",
		"get",
		"post",
		"url",
		"rest",
		"download",
		"webhook",
	],
	gate: ["approve", "approval", "ask", "person", "human", "review", "confirm"],
	branch: ["if", "else", "condition", "rule", "switch", "route", "check"],
	value: ["data", "json", "set", "compute", "expression", "transform", "map"],
	"since-last-run": [
		"new",
		"changed",
		"diff",
		"compare",
		"remember",
		"memory",
		"dedupe",
		"threshold",
		"watch",
	],
	convert: [
		"csv",
		"yaml",
		"json",
		"xml",
		"rss",
		"atom",
		"feed",
		"html",
		"text",
		"markdown",
		"table",
		"format",
	],
	wait: ["delay", "sleep", "pause", "timer", "until", "poll", "signal"],
	lease: ["lock", "one at a time", "queue", "turn", "mutex"],
	service: ["server", "docker", "compose", "stack", "start", "stop"],
	call: ["subflow", "flow", "kit", "reuse", "loop", "each", "repeat"],
	join: ["merge", "parallel", "together", "all", "first"],
	end: ["stop", "finish", "done", "exit", "result"],
};

/** How each Value preset shows: its icon and the words people search with. */
const PRESET_LOOK: Record<
	ValuePresetName,
	{ icon: LucideIcon; keywords: readonly string[] }
> = {
	filter: { icon: FunnelIcon, keywords: ["where", "keep", "match", "only"] },
	pick: { icon: Columns3Icon, keywords: ["select", "fields", "columns"] },
	sort: { icon: ArrowDownWideNarrowIcon, keywords: ["order", "rank"] },
	limit: { icon: ListStartIcon, keywords: ["first", "top", "take", "cut"] },
	unique: {
		icon: CopyMinusIcon,
		keywords: ["dedupe", "distinct", "duplicates", "unique"],
	},
};

/**
 * The first sentence of a description, for one line under a name. Empty
 * when there is none.
 */
export function firstSentence(text: string | undefined): string {
	const trimmed = text?.trim() ?? "";
	return trimmed.match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? trimmed;
}

/** A kit or a flow shows as the node that runs it: a Subflow. */
export const SUBFLOW_ICON: LucideIcon = NODE_TYPE.call.icon;

/**
 * Every entry: the nodes in palette order, the Value presets under Shape,
 * then the kits. A kit takes nothing, so it follows the nodes of its family.
 */
export const CATALOG: readonly CatalogEntry[] = [
	...PALETTE.map((item): CatalogEntry => {
		const { label, blurb, icon } = paletteMeta(item);
		return {
			key: item,
			family: paletteFamily(item),
			takes: NEW_NODE_TAKES[item],
			label,
			blurb,
			icon,
			keywords: NODE_KEYWORDS[item],
			add: { kind: "node", item },
		};
	}),
	...VALUE_PRESETS.map(
		(preset): CatalogEntry => ({
			key: `preset-${preset.name}`,
			family: NODE_FAMILY.value,
			takes: "value",
			label: preset.label,
			blurb: preset.description,
			icon: PRESET_LOOK[preset.name].icon,
			keywords: [
				"value",
				"preset",
				"list",
				...PRESET_LOOK[preset.name].keywords,
			],
			add: { kind: "preset", preset: preset.name },
		}),
	),
	...kitList().map(
		(kit): CatalogEntry => ({
			key: kit.name,
			family: kit.family,
			takes: "nothing",
			label: kit.label,
			blurb: firstSentence(kit.flow.description),
			icon: SUBFLOW_ICON,
			keywords: [
				"kit",
				"subflow",
				...kit.name.replace(/^kit:/, "").split(/[/-]/),
			],
			badge: "Kit",
			...(kit.needsFolder ? { needsFolder: true as const } : {}),
			add: { kind: "kit", flow: kit.name },
		}),
	),
];

/** One family of the node grid: its nodes and Value presets, then its kits. */
export type CatalogFamily = {
	family: NodeFamily;
	nodes: readonly CatalogEntry[];
	kits: readonly CatalogEntry[];
};

/** Whether an entry matches a search: by its name, its family or a keyword. */
export function matchesSearch(entry: CatalogEntry, query: string): boolean {
	const words = query.trim().toLowerCase();
	if (!words) return true;
	return [entry.label, NODE_FAMILY_LABEL[entry.family], ...entry.keywords].some(
		(word) => word.toLowerCase().includes(words),
	);
}

/**
 * The node grid's families, in `NODE_FAMILIES` order, with what matches
 * `query`. In each family the nodes and presets come first, then the kits:
 * the kits of Night Shift, then the flows of "My kits" in that family. A
 * family with no match is left out.
 */
export function catalogFamilies(
	entries: readonly CatalogEntry[],
	query = "",
): CatalogFamily[] {
	return NODE_FAMILIES.flatMap((family) => {
		const found = entries.filter(
			(entry) => entry.family === family && matchesSearch(entry, query),
		);
		const nodes = found.filter((entry) => entry.add.kind !== "kit");
		const kits = found.filter((entry) => entry.add.kind === "kit");
		return found.length > 0 ? [{ family, nodes, kits }] : [];
	});
}

/** Whether a value names a palette item: a recent node a browser kept, for one. */
export function isPaletteItem(value: unknown): value is PaletteItem {
	return (PALETTE as readonly unknown[]).includes(value);
}
