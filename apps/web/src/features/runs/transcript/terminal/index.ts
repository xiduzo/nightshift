/** A command as a terminal, with its output: plain, as test results, or as an error with its trace. */

export {
	isLongOutput,
	OutputSheet,
	PREVIEW_CHARS,
	PREVIEW_LINES,
} from "./output-sheet";
export { useStackTrace } from "./parsed-output";
export { StackTraceView } from "./stack-trace";
export { Terminal, type TerminalState } from "./terminal";
export { OutputViews, TerminalOutput } from "./terminal-output";
