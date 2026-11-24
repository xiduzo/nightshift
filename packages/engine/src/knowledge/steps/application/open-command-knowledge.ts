import type { CommandKnowledge } from "../../../contract";
import type { KnowledgeFolders } from "../../files";
import type { PageReaders, ReaderSecret } from "../../readers";
import type { KnowledgeReconciler } from "../../sync";
import type { StepBrief } from "./ports";

export type OpenCommandKnowledgePorts = {
	holds: Pick<KnowledgeReconciler, "startStep">;
	folders: Pick<KnowledgeFolders, "folder" | "ensure">;
	brief: Pick<StepBrief, "env">;
	/** The page readers: a Command step gets the project's. Without them, none. */
	readers?: Pick<PageReaders, "forStep">;
};

/** The project of the step, and the step's own secrets for the key of its page reader. */
export type OpenCommandKnowledge = { projectId: string; secret?: ReaderSecret };

/**
 * A Command step starts: it holds the folder (a reconcile first), makes
 * it, and gives its path in `NS_KNOWLEDGE` with the project's page reader
 * (ADR 39). A folder that cannot be made is left out. A page reader that
 * cannot open leaves the step without it: the kit reads as before. `done`
 * closes the reader, then ends the hold.
 */
export const openCommandKnowledge =
	(ports: OpenCommandKnowledgePorts) =>
	async ({
		projectId,
		secret,
	}: OpenCommandKnowledge): Promise<CommandKnowledge> => {
		const hold = await ports.holds.startStep(projectId);
		const path = ports.folders.folder(projectId);
		// The sync flows write here. A folder that cannot be made is left out.
		const made = await ports.folders
			.ensure(projectId)
			.then(() => true)
			.catch(() => false);
		if (!made) return { env: {}, done: hold.done };
		const pages = await pageReader(
			ports,
			projectId,
			secret ?? (async () => undefined),
		);
		return {
			env: { ...ports.brief.env(path), ...pages?.env },
			async done() {
				try {
					await pages?.close();
				} finally {
					await hold.done();
				}
			},
		};
	};

/** The step's page reader, or null when it cannot open. */
async function pageReader(
	ports: Pick<OpenCommandKnowledgePorts, "readers">,
	projectId: string,
	secret: ReaderSecret,
) {
	try {
		return (await ports.readers?.forStep(projectId, secret)) ?? null;
	} catch (error) {
		console.warn("The page reader of the step did not open:", error);
		return null;
	}
}
