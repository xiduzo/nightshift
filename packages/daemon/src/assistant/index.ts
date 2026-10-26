/**
 * The assistant in the flow editor, on this computer's profiles, and one
 * run as its tools read it (`chatRun`), which `nightshift mcp` reads too.
 */
export { createAssistant } from "./assistant";
export { type ChatSpace, chatRun } from "./authoring";
