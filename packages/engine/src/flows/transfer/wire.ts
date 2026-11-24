import type { Database } from "@nightshift/db";
import type { Access } from "../../access";
import type { Git } from "../../git";
import type { ProfileStore } from "../../settings";
import type { FlowMigrations } from "../migrations";
import type { FlowImports, FlowMerges, ProjectFlows } from "../store";
import { drizzleClonesHere } from "./adapters/out/drizzle-clones-here";
import { fsCloneFolders } from "./adapters/out/fs-clone-folders";
import { copyFlow } from "./application/copy-flow";
import { exportFlow } from "./application/export-flow";
import { importCloneFolders } from "./application/import-clone-folders";
import { importFlow } from "./application/import-flow";
import { importStarters } from "./application/import-starters";
import { mergeFlows } from "./application/merge-flows";
import { planFlowMerge } from "./application/plan-flow-merge";
import type {
	Clock,
	FlowUsage,
	ImportMigrations,
	SavedDocuments,
	SpaceProjects,
	ThisDevice,
} from "./application/ports";
import { createImportRuns } from "./domain/import-runs";

/** The moves of flows into and between projects, each use case bound to its ports. */
export type FlowTransfer = ReturnType<typeof wireTransfer>;

/**
 * The moves of flows: a Person's export, import, import of the starters
 * and copy into another project, each after the check that the project
 * is in the Space, Night Shift's import of each Clone's `.nightshift/`
 * folder, once, and the merge of one Project's flows into another's (the
 * merge of Personal).
 */
export function wireTransfer(deps: {
	access: Pick<Access, "openSpace">;
	db: Database;
	git: Pick<Git, "run">;
	/** The flow documents, for the import of a Clone's folder. */
	documents: FlowImports;
	saved: SavedDocuments;
	device: ThisDevice;
	clock: Clock;
	/** The merge of the flow documents. */
	merges: FlowMerges;
	/** This Device's profiles. Without them, a folder with profiles stays. */
	profiles?: Pick<ProfileStore, "list" | "save"> | undefined;
	/** What brings a Clone's flows to the current format on this Device. */
	migrations?: Pick<FlowMigrations, "forDevice"> | undefined;
	projects: SpaceProjects;
	flows: Pick<ProjectFlows, "flows" | "save">;
	/** What brings a file a Person imports to the current format. */
	importMigrations?: ImportMigrations | undefined;
	usage?: FlowUsage | undefined;
}) {
	const { projects, flows, usage } = deps;
	const people = {
		access: deps.access,
		projects,
		flows,
		...(deps.importMigrations
			? { importMigrations: deps.importMigrations }
			: {}),
		...(usage ? { usage } : {}),
	};
	return {
		exportFlow: exportFlow({ access: deps.access, projects, flows }),
		importFlow: importFlow(people),
		importStarters: importStarters(people),
		copyFlow: copyFlow({
			access: deps.access,
			projects,
			flows,
			...(usage ? { usage } : {}),
		}),
		importCloneFolders: importCloneFolders({
			documents: deps.documents,
			folders: fsCloneFolders({ git: deps.git }),
			saved: deps.saved,
			device: deps.device,
			clock: deps.clock,
			profiles: deps.profiles,
			migrations: deps.migrations,
			clones: drizzleClonesHere({ db: deps.db }),
			runs: createImportRuns(),
		}),
		planFlowMerge: planFlowMerge({ merges: deps.merges }),
		mergeFlows: mergeFlows({ merges: deps.merges, clock: deps.clock }),
	};
}
