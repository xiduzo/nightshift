import type { Tone } from "@/shared/tone";

/**
 * One part of a caption line. A plain string, or a part in mono (a node
 * id, a branch) or in a tone's color (a status word: "Running").
 */
export type CaptionPart =
	| string
	| { text: string; mono?: boolean; tone?: Tone };

/** A caption line: one string, or parts that show split by " · ". */
export type Caption = string | readonly CaptionPart[];

/** The parts of a caption, without the empty ones. */
export function captionParts(caption: Caption | undefined): CaptionPart[] {
	if (caption === undefined) return [];
	const parts = typeof caption === "string" ? [caption] : caption;
	return parts.filter((part) => partText(part).trim() !== "");
}

export function partText(part: CaptionPart): string {
	return typeof part === "string" ? part : part.text;
}

/** A caption as one line of text: "Running · website · build". */
export function captionText(caption: Caption | undefined): string {
	return captionParts(caption).map(partText).join(" · ");
}

/**
 * What a screen reader says for a row, when the screen gives no label of
 * its own: what the icon means, the title, each caption, and the value.
 * Commas, not " · ", so it reads as pauses.
 * "Needs you, Review the plan, website, Feature factory, waited 12 min".
 */
export function rowLabel(row: {
	iconLabel?: string;
	title: string;
	overline?: string;
	/** The word of a status line under the title: "2 Gates need you". */
	status?: string;
	caption?: Caption;
	detail?: Caption;
	value?: string;
	valueLabel?: string;
}): string {
	return [
		row.iconLabel,
		row.title,
		row.overline,
		row.status,
		...captionParts(row.caption).map(partText),
		...captionParts(row.detail).map(partText),
		row.valueLabel ?? row.value,
	]
		.filter((part): part is string => part !== undefined && part.trim() !== "")
		.join(", ");
}
