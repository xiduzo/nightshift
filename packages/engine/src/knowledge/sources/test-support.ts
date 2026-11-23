import type { KnowledgeListing } from "../files";
import type { SourcesSpace } from "./application/ports";
import type { SourceRun } from "./domain/syncs";
import { wireSources } from "./wire";

/** The sources in `space` over these files, bound as `wireSources` binds them: for the tests that moved with it. */
export function knowledgeSources<Run extends SourceRun>(deps: {
	space: SourcesSpace<Run>;
	files: {
		listing(projectId: string): Promise<KnowledgeListing>;
		removeFolder(projectId: string, folder: string): Promise<number>;
	};
	readerReady(projectId: string): Promise<boolean>;
	device: { id: string; name: string };
}) {
	return wireSources({
		access: { openSpace: async () => {} },
		files: deps.files,
		readers: { ready: deps.readerReady },
		device: deps.device,
	}).sourcesIn(deps.space);
}
