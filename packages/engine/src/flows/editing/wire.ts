import type { Access } from "../../access";
import type { ProjectFlows } from "../store";
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
 * node memory of a flow on this computer. Each use case asks who may act,
 * then checks that the project is in the Space.
 */
export function wireEditing(deps: {
	access: Pick<Access, "openSpace">;
	projects: SpaceProjects;
	flows: Pick<
		ProjectFlows,
		"flows" | "save" | "remove" | "revisions" | "notices" | "dismissNotice"
	>;
	/** Without them, a revision names nobody and no Device. */
	names?: Partial<Names>;
	usage?: FlowUsage;
	kept: KeptValues;
	memory: NodeMemory;
}) {
	const { access, projects, flows, kept, memory } = deps;
	const names: Names = {
		persons: deps.names?.persons ?? NO_NAMES,
		devices: deps.names?.devices ?? NO_NAMES,
	};
	return {
		listFlows: listFlows({ access, projects, flows }),
		readFlow: readFlow({ access, projects, flows }),
		readFlowMap: readFlowMap({ access, projects, flows }),
		saveFlow: saveFlow({
			access,
			projects,
			flows,
			...(deps.usage ? { usage: deps.usage } : {}),
		}),
		removeFlow: removeFlow({ access, projects, flows }),
		listFlowNotices: listFlowNotices({ access, projects, flows }),
		dismissFlowNotice: dismissFlowNotice({ access, projects, flows }),
		listFlowRevisions: listFlowRevisions({ access, projects, flows, names }),
		readFlowRevision: readFlowRevision({ access, projects, flows, names }),
		restoreFlowRevision: restoreFlowRevision({
			access,
			projects,
			flows,
		}),
		listKeptValues: listKeptValues({ access, projects, kept }),
		resetKeptValue: resetKeptValue({ access, projects, kept }),
		listNodeMemory: listNodeMemory({ access, projects, memory }),
		forgetNodeMemory: forgetNodeMemory({ access, projects, memory }),
	};
}
