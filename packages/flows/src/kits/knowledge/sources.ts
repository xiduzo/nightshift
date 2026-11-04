import { z } from "zod";
import type { Flow } from "../../flow";
import { nameSchema } from "../../nodes";
import { kitFlow } from "../kits";
import {
	type KnowledgeSourceKit,
	knowledgeSourceKitSchema,
} from "./source-kits";
import { KNOWLEDGE_FOLDER_INPUT } from "./sync-kit";

/**
 * Knowledge sources: what a person adds on the Knowledge page. A source
 * IS a flow (ADR 4, decision 6): one Subflow node that calls a
 * `kit:knowledge/*` kit with the person's values, and a schedule of it
 * when it keeps itself up to date. No second store: the page reads the
 * flows back. Which sources exist is `source-kits.ts`. A source's values
 * live here, for the page and the engine. What saving, listing and removing
 * one does to the Space's flows and schedules is the engine's
 * (`knowledgeSources`).
 */

/** A source as a person fills it in: the kit and its values, by input name. */
export const knowledgeSourceSchema = z.object({
	kit: knowledgeSourceKitSchema,
	inputs: z.record(nameSchema, z.string().max(20_000)),
});
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;

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
