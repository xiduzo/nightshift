/** The execution port (`Device`): this computer (`localDevice`), commands and tool calls. A Device reached through a Host is `@nightshift/devices`' `remoteDevice`. */

export { runCommand, tailOf } from "./command";
export { localDevice } from "./local";
export { createToolLaunchers } from "./tool-launchers";
export type {
	Capabilities,
	CapabilityQuery,
	Device,
	ExecEvent,
	ExecInput,
	OfferedSessionInput,
	RunRef,
	SessionEvent,
	SessionInput,
	ToolCallInput,
	ToolResult,
	Worktree,
} from "./types";
