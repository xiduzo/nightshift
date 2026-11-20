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

/** A flow of a format older than this Night Shift's. */
export function olderFormat(json: unknown): boolean {
	const version =
		typeof json === "object" && json !== null && "version" in json
			? json.version
			: undefined;
	return typeof version === "number" && version < FLOW_VERSION;
}

/**
 * Why a revision exists. `upgrade`: Night Shift brought the flow to a newer
 * format (`upgradeFlows`), nobody changed it. `infer`: Night Shift kept the
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
 * A stored revision as this Night Shift reads it, or null: one that does
 * not read as a revision, and one from a newer Night Shift, stay for the
 * history only.
 */
export function readableRevision(value: unknown): FlowRevision | null {
	const parsed = flowRevisionSchema.safeParse(value);
	return parsed.success && parsed.data.flow.version <= FLOW_VERSION
		? parsed.data
		: null;
}
