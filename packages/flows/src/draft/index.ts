/**
 * Pure edits on a flow draft. The editor keeps the draft as a `Flow` and every
 * change goes through one of these, so the JSON on disk is exactly the draft.
 * The words the editor shows stay in the app.
 */

export {
	checkDraft,
	type DraftCheckOptions,
	type DraftMessages,
	type DraftSchemaIssue,
	type FlowCheck,
	isSavable,
	type KnownProfile,
} from "./check";
export {
	type CliToolRef,
	commandOf,
	programsWithoutLogin,
} from "./cli-programs";
export { copyNodes, type FlowClip, pasteNodes } from "./clipboard";
export type { FolderNeed } from "./folder";
export {
	addCalledNode,
	addEdge,
	addNode,
	addNodeAfter,
	edgeInLoop,
	moveNode,
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
	type NameClash,
	type NameOwner,
	nameClash,
	uniqueName,
	uniqueOutputName,
} from "./names";
export {
	defaultEach,
	emptySource,
	emptyUntil,
	type NodeDefaults,
	newElementFlow,
	newFlow,
	type Position,
	withConnections,
	withDecidedBy,
	withOutputSchema,
	withTool,
	withValueBy,
	withWrites,
} from "./nodes";
export {
	isOptionNode,
	type NodeOption,
	nodeOptions,
	type OptionNode,
	removeOutcome,
	renameOutcome,
	restoreAgentOutcomes,
	restoreCallEach,
	restoreOutcome,
	setAgentOutcomes,
	setCallEach,
	uniqueOptionName,
	withOptions,
} from "./outcomes";
export { type DataLink, dataLinks } from "./reads";
export {
	renameInput,
	renameVariable,
} from "./refs";
export {
	addSection,
	removeSection,
	type SectionFields,
	updateSection,
} from "./sections";
export {
	planSubflowFromSection,
	type SubflowBlocker,
	type SubflowChange,
	type SubflowInputSource,
	type SubflowOptions,
	type SubflowPlan,
	type SubflowReader,
} from "./subflow";
