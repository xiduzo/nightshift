import type { DeviceStore } from "./ports";

export type FindKeptDocumentOwnerPorts = {
	store: Pick<DeviceStore, "paired">;
	/** The start of the name of a Device's document: the Device id follows it. */
	documentPrefix: string;
};

/** What the request asks for: the name of a document. */
export type FindKeptDocumentOwner = { documentName: string };

/**
 * The owner of a Device document this Host keeps for a paired Device:
 * one whose home Host it is, with access. Null for any other name.
 *
 * The document relay asks it: the use case takes the request alone.
 */
export const findKeptDocumentOwner =
	(ports: FindKeptDocumentOwnerPorts) =>
	async (request: FindKeptDocumentOwner): Promise<string | null> => {
		const { documentName } = request;
		const prefix = ports.documentPrefix;
		if (!documentName.startsWith(prefix)) return null;
		const found = await ports.store.paired(documentName.slice(prefix.length));
		if (!found || found.revokedAt || found.homeHost === null) return null;
		return found.ownerId;
	};
