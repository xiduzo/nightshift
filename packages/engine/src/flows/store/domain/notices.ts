import { z } from "zod";

/**
 * What a person must know about the flows of a Project. A notice lives in
 * the flow document, so every Device of the Space shows it, until a person
 * dismisses it.
 */

const storedNoticeSchema = z.object({
	at: z.number(),
	deviceId: z.string(),
	kind: z.string(),
	message: z.string(),
});

/** A notice as a person reads it. */
export type FlowNotice = {
	id: string;
	at: number;
	/** The Device that made it. */
	deviceId: string;
	kind: string;
	message: string;
};

/** A notice as Night Shift adds it. */
export type NewNotice = {
	/** Why it exists: the Project moved by itself. */
	kind: "project-moved";
	message: string;
	deviceId: string;
	at: number;
};

/** The stored notices, by id, as a person reads them: oldest first. One this Night Shift cannot read is left out. */
export function readableNotices(
	stored: Iterable<[string, unknown]>,
): FlowNotice[] {
	const notices: FlowNotice[] = [];
	for (const [id, value] of stored) {
		const parsed = storedNoticeSchema.safeParse(value);
		if (parsed.success) notices.push({ id, ...parsed.data });
	}
	return notices.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
}
