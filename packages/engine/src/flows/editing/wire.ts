import type { Access } from "../../access";
import { dismissFlowNotice } from "./application/dismiss-flow-notice";
import { forgetNodeMemory } from "./application/forget-node-memory";
import { listFlowNotices } from "./application/list-flow-notices";
import { listFlowRevisions } from "./application/list-flow-revisions";
import { listFlows } from "./application/list-flows";
import { listKeptValues } from "./application/list-kept-values";
import { listNodeMemory } from "./application/list-node-memory";
import type {
	FlowUsage,
	KeptValues,
	Names,
	NodeMemory,
	SavedFlows,
	SpaceProjects,
} from "./application/ports";
import { readFlow } from "./application/read-flow";
import { readFlowMap } from "./application/read-flow-map";
import { readFlowRevision } from "./application/read-flow-revision";
import { removeFlow } from "./application/remove-flow";
import { resetKeptValue } from "./application/reset-kept-value";
import { restoreFlowRevision } from "./application/restore-flow-revision";
import { saveFlow } from "./application/save-flow";

/** What a Person does with the flows of a Space, each use case bound to its ports. */
export type FlowEditing = ReturnType<typeof wireEditing>;

const NO_NAMES = async () => new Map<string, string>();

/**
 * The editing of the flows of a Space: list, read, save and remove flows,
 * their notices, their revisions and a restore, and the kept values and
 * node memory of a flow on this computer. Each use case checks that the
 * project is in the Space first.
 */
export function wireEditing(deps: {
	access: Pick<Access, "openSpace">;
	projects: SpaceProjects;
	flows: SavedFlows;
	/** Without them, a revision names nobody and no Device. */
	names?: Partial<Names>;
	usage?: FlowUsage;
	kept: KeptValues;
	memory: NodeMemory;
}) {
	const { projects, flows, kept, memory } = deps;
	const names: Names = {
		persons: deps.names?.persons ?? NO_NAMES,
		devices: deps.names?.devices ?? NO_NAMES,
	};
	return {
		listFlows: listFlows({ projects, flows }),
		readFlow: readFlow({ projects, flows }),
		readFlowMap: readFlowMap({ projects, flows }),
		saveFlow: saveFlow({
			access: deps.access,
			projects,
			flows,
			...(deps.usage ? { usage: deps.usage } : {}),
		}),
		removeFlow: removeFlow({ access: deps.access, projects, flows }),
		listFlowNotices: listFlowNotices({ projects, flows }),
		dismissFlowNotice: dismissFlowNotice({ projects, flows }),
		listFlowRevisions: listFlowRevisions({ projects, flows, names }),
		readFlowRevision: readFlowRevision({ projects, flows, names }),
		restoreFlowRevision: restoreFlowRevision({
			access: deps.access,
			projects,
			flows,
		}),
		listKeptValues: listKeptValues({ projects, kept }),
		resetKeptValue: resetKeptValue({ projects, kept }),
		listNodeMemory: listNodeMemory({ projects, memory }),
		forgetNodeMemory: forgetNodeMemory({ projects, memory }),
	};
}
