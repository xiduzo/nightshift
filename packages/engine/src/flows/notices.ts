import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FlowDocument } from "./flow-document";

/**
 * What a person must know about the flows of a Project: what the import
 * on upgrade did that they did not ask for. A notice lives in the flow
 * document, so every Device of the Space shows it, until a person
 * dismisses it.
 */

/** Why a notice exists. */
export const noticeKinds = [
	"folder-kept",
	"flow-renamed",
	"schedule-renamed",
	"profiles-made",
] as const;
export type NoticeKind = (typeof noticeKinds)[number];

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
	/** The Device whose import made it. */
	deviceId: string;
	kind: string;
	message: string;
};

/** Every notice of the document, oldest first. One this Night Shift cannot read is left out. */
export function flowNotices(document: FlowDocument): FlowNotice[] {
	const notices: FlowNotice[] = [];
	for (const [id, value] of document.notices.entries()) {
		const parsed = storedNoticeSchema.safeParse(value);
		if (parsed.success) notices.push({ id, ...parsed.data });
	}
	return notices.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
}

/** The notices as they go into the document in one change: call inside `current.change`. */
export function addNotices(
	document: FlowDocument,
	notices: readonly {
		kind: NoticeKind;
		message: string;
		deviceId: string;
		at: number;
	}[],
): void {
	// The index leads the id, so notices of one change and one time keep their order.
	notices.forEach((notice, index) => {
		document.notices.set(`${String(index).padStart(4, "0")}-${randomUUID()}`, {
			...notice,
		});
	});
}

/** Removes a notice. One that is gone already is no error. */
export async function dismissNotice(
	document: FlowDocument,
	id: string,
): Promise<void> {
	if (!document.notices.has(id)) return;
	await document.current.change(() => document.notices.delete(id));
}
