/** The names of a draft: free names and the clash of a new name, renames in templates and rules, and what the texts of a flow read. */

export {
	type NameClash,
	type NameOwner,
	nameClash,
	takenNames,
	uniqueEdgeId,
	uniqueName,
	uniqueNodeId,
	uniqueOutputName,
} from "./names";
export {
	type DataLink,
	dataLinks,
	type FlowRead,
	flowReads,
	type NodeRead,
	nodeReads,
	readsOf,
} from "./reads";
export {
	renameInFlow,
	renameInput,
	renameVariable,
	rewriteRefs,
	rewriteTemplates,
} from "./refs";
