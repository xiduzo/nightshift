import { z } from "zod";
import type { Flow } from "../../flow";
import { nameSchema } from "../../nodes";
import { kitFlow } from "../kits";

/**
 * Knowledge sources: what a person adds on the Knowledge page. A source
 * IS a flow (ADR 4, decision 6): one Subflow node that calls a
 * `kit:knowledge/*` kit with the person's values, and a schedule of it
 * when it keeps itself up to date. No second store: the page reads the
 * flows back. What a source is lives here, for the page and the engine.
 * What saving, listing and removing one does to the Space's flows and
 * schedules is the engine's (`knowledgeSources`).
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

export const knowledgeSourceKitSchema = z.enum(SOURCE_KITS);
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

/**
 * The input every knowledge kit has: its folder in the knowledge. Night
 * Shift picks it for a source, so the page does not ask for it.
 */
export const KNOWLEDGE_FOLDER_INPUT = "folder";

/** The inputs a kit declares, by its name: none for a name that is not a kit. */
export function knowledgeKitInputs(kit: string): NonNullable<Flow["inputs"]> {
	return kitFlow(kit)?.inputs ?? [];
}

/**
 * The fields a person fills in for a kind of source: its kit's inputs,
 * but not its folder.
 */
export function knowledgeSourceFields(
	kit: KnowledgeSourceKit,
): NonNullable<Flow["inputs"]> {
	return knowledgeKitInputs(kit).filter(
		(input) => input.name !== KNOWLEDGE_FOLDER_INPUT,
	);
}

/**
 * Why a source's values cannot be kept, or null: a value with `{{`. A
 * source keeps plain values. In its flow `{{` starts a template, and a
 * flow with one is no longer a source the Knowledge page can edit.
 */
export function knowledgeSourceBracesProblem(
	source: KnowledgeSource,
): string | null {
	const labels = knowledgeKitInputs(source.kit)
		.filter((input) => source.inputs[input.name]?.includes("{{"))
		.map((input) => input.label ?? input.name);
	if (labels.length === 0) return null;
	return `${labels.join(", ")} cannot contain {{. Remove it.`;
}
