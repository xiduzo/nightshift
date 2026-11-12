import type { GateChoice, OpenGate } from "./types";

/**
 * The brief of a Gate (ADR 21) as both apps show it: why you decide
 * (the situation), what is already done (the background), the option the
 * flow recommends, and which parts Night Shift wrote. An empty part is
 * null, so a screen leaves it out.
 */

/** One item of the background, with where it comes from: "Tests pass", "CI". */
export type BackgroundItem = { text: string; source: string | null };

export type BriefView = {
	situation: { text: string; byModel: boolean } | null;
	background: { items: BackgroundItem[]; byModel: boolean } | null;
	recommendation: {
		/** The name of the recommended option. Null: the reason only. */
		option: string | null;
		reason: string | null;
		byModel: boolean;
	} | null;
	/** Night Shift wrote what an option does, for at least one option. */
	impactsByModel: boolean;
};

function filled(text: string | null | undefined): string | null {
	const trimmed = text?.trim() ?? "";
	return trimmed === "" ? null : trimmed;
}

/**
 * The brief of a Gate, part by part. A Host older than the brief sends
 * none: every part is empty.
 */
export function briefView(gate: {
	brief?: OpenGate["brief"];
	choices: readonly Pick<GateChoice, "impact">[];
}): BriefView {
	const brief = gate.brief;
	const byModel = new Set(brief?.byModel ?? []);
	const situation = filled(brief?.situation);
	const items = (brief?.background ?? []).flatMap((item) => {
		const text = filled(item.text);
		return text ? [{ text, source: filled(item.source) }] : [];
	});
	const option = filled(brief?.recommendation?.option);
	const reason = filled(brief?.recommendation?.reason);
	return {
		situation: situation
			? { text: situation, byModel: byModel.has("situation") }
			: null,
		background:
			items.length > 0 ? { items, byModel: byModel.has("background") } : null,
		recommendation:
			option || reason
				? { option, reason, byModel: byModel.has("recommendation") }
				: null,
		impactsByModel:
			byModel.has("impacts") &&
			gate.choices.some((choice) => filled(choice.impact) !== null),
	};
}

/** The line under an option: what happens when you pick it, or else its description. */
export function choiceLine(
	choice: Pick<GateChoice, "impact" | "description">,
): string | null {
	return filled(choice.impact) ?? filled(choice.description);
}

/** The quiet word on a part of the brief that Night Shift wrote. */
export const WRITTEN_BY_NIGHT_SHIFT = "Written by Night Shift";
