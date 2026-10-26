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
} from "./check";
export { copyNodes, type FlowClip, pasteNodes } from "./clipboard";
export {
	addEdge,
	addNode,
	callersOf,
	edgeInLoop,
	moveNode,
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
	commandNode,
	defaultEach,
	emptySource,
	emptyUntil,
	type NodeDefaults,
	newElementFlow,
	newFlow,
	type Position,
	withConnections,
	withDecidedBy,
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
