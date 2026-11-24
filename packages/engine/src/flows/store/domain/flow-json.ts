import { FLOW_VERSION } from "@nightshift/flows";
import { z } from "zod";

/** The same JSON, whatever the order of the keys. */
export function same(a: unknown, b: unknown): boolean {
	return stableJson(a) === stableJson(b);
}

/** The JSON of a value with the keys of each object sorted. */
export function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, inner: unknown) =>
		inner !== null && typeof inner === "object" && !Array.isArray(inner)
			? Object.fromEntries(
					Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1)),
				)
			: inner,
	);
}

/** A format next to this Night Shift's. Only a `current` flow is read and changed. */
export type FlowFormat = "older" | "current" | "newer";

/** What the format of a stored flow is next to this Night Shift's. */
export function formatOf(version: number): FlowFormat {
	if (version === FLOW_VERSION) return "current";
	return version < FLOW_VERSION ? "older" : "newer";
}

/**
 * Why a revision exists. `upgrade`: Night Shift brought the flow to a newer
 * format, nobody changed it. Nothing writes it now, and the history keeps
 * it. `infer`: Night Shift kept the
 * shape of a run's data on a node that had no output schema (`keepShapes`),
 * or the type of a value on a flow output that had none (`keepOutputTypes`).
 * An older Night Shift does not read an `infer` revision: it leaves it out
 * of the list.
 */
export const revisionKinds = [
	"save",
	"restore",
	"import",
	"merge",
	"copy",
	"upgrade",
	"infer",
] as const;
export type RevisionKind = (typeof revisionKinds)[number];

const flowRevisionSchema = z.object({
	id: z.string(),
	at: z.number(),
	personId: z.string().nullable(),
	deviceId: z.string(),
	kind: z.enum(revisionKinds),
	flow: z.looseObject({ version: z.number() }),
});
/** One save of a flow: who, when, on which Device, why, and the whole flow. */
export type FlowRevision = z.infer<typeof flowRevisionSchema>;

/**
 * A stored revision as this Night Shift lists it, or null: one that does
 * not read as a revision, and one from a newer Night Shift, stay for the
 * history only. The flow of one in an older format does not read.
 */
export function readableRevision(value: unknown): FlowRevision | null {
	const parsed = flowRevisionSchema.safeParse(value);
	return parsed.success && parsed.data.flow.version <= FLOW_VERSION
		? parsed.data
		: null;
}
