import type { KnowledgeDocuments } from "../../sync";
import { keyOf, type ReaderSecret } from "../domain/reader-choice";

export type CheckReaderReadyPorts = {
	documents: Pick<KnowledgeDocuments, "open">;
	/** A secret of this computer outside a run. Without it, no service reader is ready. */
	secret?: ReaderSecret;
};

/** The project whose reader to check. */
export type CheckReaderReady = { projectId: string };

/**
 * Whether the secret of the project's reader is saved where this computer
 * finds it outside a run. Always true for Night Shift's own reader, which
 * has no key. A secret that cannot be read counts as not saved.
 */
export const checkReaderReady =
	(ports: CheckReaderReadyPorts) =>
	async ({ projectId }: CheckReaderReady): Promise<boolean> => {
		const setting = (await ports.documents.open(projectId)).reader();
		if (setting.kind === "nightshift") return true;
		return Boolean(await keyOf(setting, ports.secret));
	};
