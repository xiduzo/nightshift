/** The execution port (`Device`): this computer (`localDevice`), commands and tool calls. A Device reached through a Host is `@nightshift/devices`' `remoteDevice`. */

export { runCommand, tailOf } from "./command";
export { type Harnesses, localDevice } from "./local";
export {
	createToolLaunchers,
	loginReferences,
	type SignInResult,
	type ToolLaunchers,
} from "./tool-launchers";
export type {
	AddressCheck,
	Capabilities,
	CapabilityQuery,
	Device,
	ExecEvent,
	ExecInput,
	GitAuthor,
	OfferedSessionInput,
	ReadFileInput,
	ReadFileResult,
	RequestField,
	RequestPart,
	RequestText,
	RunFolder,
	RunRef,
	SessionEvent,
	SessionInput,
	ToolCallInput,
	ToolResult,
	WebRequestInput,
	WebRequestResult,
	WebResponse,
	Worktree,
} from "./types";
export { addressKey } from "./types";
