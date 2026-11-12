// What the add-node dialog and the node dock offer: every node a person can
// add, the Value presets and the kits, each in the family of its role.

import {
	kitList,
	NEW_NODE_TAKES,
	NODE_FAMILIES,
	NODE_FAMILY,
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
import {
	NODE_TYPE,
	type PaletteItem,
	paletteMeta,
} from "../../canvas/node-type";

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
	/** Unique in the catalog. The dialog's search reads it too. */
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
	add: CatalogAdd;
};

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
			add: { kind: "kit", flow: kit.name },
		}),
	),
];

/** One group of the dialog: entries of one family that all start from nothing, or all take a value. */
export type CatalogGroup = {
	family: NodeFamily;
	takes: Takes;
	entries: readonly CatalogEntry[];
};

/**
 * The dialog's groups, in `NODE_FAMILIES` order. In each family the
 * entries that start from nothing come first, then those that take a
 * value. A group never mixes the two. An empty group is left out.
 */
export function catalogGroups(
	entries: readonly CatalogEntry[] = CATALOG,
): CatalogGroup[] {
	return NODE_FAMILIES.flatMap((family) =>
		(["nothing", "value"] as const).flatMap((takes) => {
			const inGroup = entries.filter(
				(entry) => entry.family === family && entry.takes === takes,
			);
			return inGroup.length > 0 ? [{ family, takes, entries: inGroup }] : [];
		}),
	);
}
