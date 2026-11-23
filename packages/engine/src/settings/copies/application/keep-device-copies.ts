import type { DeviceDocuments } from "./ports";

export type KeepDeviceCopiesPorts<Doc> = {
	documents: DeviceDocuments<Doc>;
	/** This computer's Device id: its own document is never a copy. */
	selfId: string;
	/** The names the Host gave, for a Device that reports none itself. Shared with the reads of the copies. */
	named: Map<string, string>;
};

/**
 * Keeps a copy of each of these Devices' documents, and drops the copies
 * of every other Device: what the home Host lists, with the name it knows
 * each by. Answers the documents to sync, under their Device document
 * names, by Device id.
 */
export const keepDeviceCopies =
	<Doc>(ports: KeepDeviceCopiesPorts<Doc>) =>
	async (
		devices: readonly { id: string; name: string }[],
	): Promise<{ name: string; doc: Doc }[]> => {
		const listed = devices.filter((d) => d.id !== ports.selfId);
		for (const d of listed) ports.named.set(d.id, d.name);
		const wanted = new Set(listed.map((d) => d.id));
		for (const id of await ports.documents.copyIds()) {
			if (id === ports.selfId || wanted.has(id)) continue;
			ports.named.delete(id);
			await ports.documents.dropCopy(id);
		}
		const synced: { name: string; doc: Doc }[] = [];
		for (const id of [...wanted].sort()) {
			const { doc, syncName } = await ports.documents.openCopy(id);
			synced.push({ name: syncName, doc });
		}
		return synced;
	};
