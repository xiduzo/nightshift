/** Edits of the flow graph (nodes, edges, inputs, outputs, variables, the run policy) and of the flow's Sections. */

export {
	addCalledNode,
	addEdge,
	addNode,
	addNodeAfter,
	edgeInLoop,
	moveNodes,
	NEW_NODE_TAKES,
	type NewNodeKind,
	removeEdge,
	removeNode,
	renameNode,
	setInputs,
	setOutputs,
	setPolicyValue,
	setVariables,
	updateEdge,
	updateNode,
} from "./graph";
export {
	addSection,
	removeSection,
	removeSectionAndInside,
	type SectionFields,
	uniqueSectionId,
	updateSection,
} from "./sections";
