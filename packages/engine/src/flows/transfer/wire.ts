import type { Access } from "../../access";
import type { FlowMerges, ProjectFlows } from "../store";
import { copyFlow } from "./application/copy-flow";
import { exportFlow } from "./application/export-flow";
import { importFlow } from "./application/import-flow";
import { importStarters } from "./application/import-starters";
import { mergeFlows } from "./application/merge-flows";
import { planFlowMerge } from "./application/plan-flow-merge";
import type {
	Clock,
	FlowUsage,
	ImportMigrations,
	SpaceProjects,
} from "./application/ports";

/** The moves of flows into and between projects, each use case bound to its ports. */
export type FlowTransfer = ReturnType<typeof wireTransfer>;

/**
 * The moves of flows: a Person's export, import, import of the starters
 * and copy into another project, each after the check that the project
 * is in the Space, and the merge of one Project's flows into another's
 * (the merge of Personal).
 */
export function wireTransfer(deps: {
	access: Pick<Access, "openSpace">;
	clock: Clock;
	/** The merge of the flow documents. */
	merges: FlowMerges;
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
		planFlowMerge: planFlowMerge({ merges: deps.merges }),
		mergeFlows: mergeFlows({ merges: deps.merges, clock: deps.clock }),
	};
}
