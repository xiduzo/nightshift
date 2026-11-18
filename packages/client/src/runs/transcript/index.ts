/** What an agent's transcript holds: its tool calls in groups, its to-do list, its subagents, and the files it changed. */

export {
	addsFiles,
	type ChangedFile,
	changedFiles,
	type FileChange,
	type FileTreeNode,
	fileTree,
} from "./changed-files";
export { projectPath } from "./project-path";
export {
	applyStepChanges,
	lastWorktreeChanges,
	linesLabel,
	type StepChangedFiles,
	type StepChanges,
	stepChangedFiles,
} from "./step-changes";
export { isLaunchNotice, subagentTask } from "./subagent";
export { stepTodos, type Todo } from "./todos";
export {
	groupToolCalls,
	type ToolKind,
	toolCallsSummary,
	toolKind,
} from "./tool-calls";
