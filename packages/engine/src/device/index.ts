/** The execution port (`Device`): this computer (`localDevice`), a Device reached through a Host (`remoteDevice`), commands and tool calls. */

export { runCommand, tailOf } from "./command";
export { localDevice } from "./local";
export type { WorkCall, WorkRelay, WorkReply, WorkRequest } from "./remote";
export {
	remoteDevice,
	serveWork,
	workReplySchema,
	workRequestSchema,
} from "./remote";
export type {
	Capabilities,
	Device,
	ExecEvent,
	ExecInput,
	OfferedSessionInput,
	SessionEvent,
	SessionInput,
} from "./types";
