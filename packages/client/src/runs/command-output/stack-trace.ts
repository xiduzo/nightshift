/**
 * The first stack trace in a command's output, as an error and its frames:
 * V8 (Node, Bun, Deno, browsers), Python tracebacks, the JVM (Java, Kotlin,
 * Scala, with `Caused by:`) and Go panics. Frames come innermost first, the
 * order V8 and the JVM print them, so a Python traceback is read backwards.
 * `internal` marks frames of the runtime and of dependencies, which a person
 * rarely needs to read first.
 */

import { plainLines } from "./plain-lines";

export type StackFrame = {
	/** The function or method: `getUser`, `com.example.App.load`, `main.lookup`. */
	fn?: string;
	file?: string;
	line?: number;
	column?: number;
	/** A frame of the runtime or of a dependency, not of the project. */
	internal: boolean;
	/** The frame as printed, trimmed. */
	text: string;
};

export type StackError = {
	/** `TypeError`, `java.lang.IllegalStateException`, `ValueError`, `panic`. */
	type?: string;
	message: string;
};

export type StackTrace = {
	language: "javascript" | "python" | "jvm" | "go";
	error: StackError;
	frames: StackFrame[];
	/** What caused the error, the direct cause first (`Caused by:`, chained Python exceptions). */
	causes?: { error: StackError; frames: StackFrame[] }[];
};

/** A crash prints its trace last, so a long output is read mostly from its end. */
const SCAN = { head: 64_000, tail: 192_000 };
/** A deep recursion prints thousands of frames; nobody reads past these. */
const MAX_FRAMES = 200;

export function parseStackTrace(text: string): StackTrace | null {
	if (!text) return null;
	const lines = plainLines(text, SCAN);
	const starts: { at: number; parse: () => StackTrace | null }[] = [];
	const js = lines.findIndex(isJsFrame);
	if (js >= 0) starts.push({ at: js, parse: () => parseJs(lines, js) });
	const jvm = lines.findIndex(isJvmFrame);
	if (jvm >= 0) starts.push({ at: jvm, parse: () => parseJvm(lines, jvm) });
	const python = lines.findIndex((line) => PY_START.test(line));
	if (python >= 0)
		starts.push({ at: python, parse: () => parsePython(lines, python) });
	const go = lines.findIndex((line) => GO_PANIC.test(line));
	if (go >= 0) starts.push({ at: go, parse: () => parseGo(lines, go) });
	starts.sort((a, b) => a.at - b.at);
	for (const start of starts) {
		const trace = start.parse();
		if (trace && trace.frames.length > 0) return trace;
	}
	return null;
}

// V8 ------------------------------------------------------------------------

const JS_CALL = /^\s*at (?:async )?(.+?) \((.+)\)\s*$/;
const JS_BARE = /^\s*at (?:async )?(\S+)\s*$/;
const JS_LOCATION = /^(.*?):(\d+)(?::(\d+))?$/;
/** A file part that looks like a path, a URL or a runtime module, not `8` from `(8:30)`. */
const JS_FILE = /[/\\.]|^(?:node|bun|native|file|https?|webpack|<)/;
/** `TypeError: …`, `Error [ERR_X]: …`, Bun's `error: …`; then any `Name: …`. */
const JS_ERRORS = [
	/^\s*(?:Uncaught )?((?:[\w$]+\.)*[\w$]*(?:Error|Exception)|error)(?: \[[\w-]+\])?: (.*)$/,
	/^\s*(?:Uncaught )?([A-Z][\w$]*)(?: \[[\w-]+\])?: (.*)$/,
];

function jsLocation(where: string) {
	const place = JS_LOCATION.exec(where.replace(/^file:\/\//, ""));
	if (!place || !JS_FILE.test(place[1] as string)) return undefined;
	return {
		file: place[1] as string,
		line: Number(place[2]),
		...(place[3] ? { column: Number(place[3]) } : {}),
	};
}

function jsFrame(line: string): StackFrame | undefined {
	const call = JS_CALL.exec(line);
	if (call) {
		const where = call[2] as string;
		const place = jsLocation(where);
		if (!place && !/^(?:<anonymous>|native|index \d+)$/.test(where))
			return undefined;
		const fn = (call[1] as string).replace(/^new /, "new ");
		return {
			fn,
			...place,
			internal: place ? isJsInternal(place.file) : true,
			text: line.trim(),
		};
	}
	const bare = JS_BARE.exec(line);
	if (bare) {
		const place = jsLocation(bare[1] as string);
		if (!place) return undefined;
		return { ...place, internal: isJsInternal(place.file), text: line.trim() };
	}
	return undefined;
}

const isJsFrame = (line: string) => jsFrame(line) !== undefined;

function isJsInternal(file: string): boolean {
	return (
		/^(?:node:|internal\/|native|bun:)/.test(file) ||
		/[/\\]node_modules[/\\]/.test(file) ||
		/[/\\]\.bun[/\\]install[/\\]/.test(file)
	);
}

/** `1 | code` and the `^` under it: the code Node and Bun quote above an error. */
const CODE_FRAME = /^\s*>?\s*\d+\s*\|/;
const CARET = /^\s*\^+\s*$/;

function parseJs(lines: string[], first: number): StackTrace | null {
	const frames: StackFrame[] = [];
	for (let i = first; i < lines.length && frames.length < MAX_FRAMES; i++) {
		const frame = jsFrame(lines[i] as string);
		if (!frame) break;
		frames.push(frame);
	}
	return {
		language: "javascript",
		error: errorAbove(lines, first, JS_ERRORS),
		frames,
	};
}

/**
 * The error printed above the first frame: the nearest line that matches the
 * first pattern that any line matches, with the lines between it and the
 * frames as the rest of the message; else the nearest line of text.
 */
function errorAbove(
	lines: string[],
	first: number,
	patterns: RegExp[],
): StackError {
	const floor = Math.max(0, first - 12);
	for (const pattern of patterns)
		for (let i = first - 1; i >= floor; i--) {
			const match = pattern.exec(lines[i] as string);
			if (!match) continue;
			const rest = lines
				.slice(i + 1, first)
				.filter(
					(line) => line.trim() && !CODE_FRAME.test(line) && !CARET.test(line),
				)
				.map((line) => line.trim());
			const type = match[1] === "error" ? undefined : match[1];
			const message = [match[2] ?? "", ...rest].join("\n").trim();
			return type ? { type, message } : { message };
		}
	for (let i = first - 1; i >= floor; i--) {
		const line = (lines[i] as string).trim();
		if (line && !CODE_FRAME.test(line) && !CARET.test(line))
			return { message: line };
	}
	return { message: "" };
}

// JVM -----------------------------------------------------------------------

const JVM_FRAME =
	/^\s*at (?:([\w.-]+(?:@[^/\s]*)?)\/\/?)?([^\s(/][^(]*[^\s(])\(([^()]*)\)\s*$/;
const JVM_LOCATION =
	/^([\w$.-]+\.\w+)(?::(\d+))?$|^(?:Native Method|Unknown Source)$/;
const JVM_ERROR =
	/^\s*(?:Exception in thread "[^"]*" )?((?:[\w$]+\.)+[\w$]+|[\w$]*(?:Exception|Error|Throwable))(?:: (.*))?$/;
const JVM_CAUSE = /^\s*Caused by: (.*)$/;
const JVM_MORE = /^\s*\.\.\. \d+ (?:more|common frames omitted)\s*$/;
const JVM_INTERNAL =
	/^(?:java|javax|jdk|sun|com\.sun|kotlin|kotlinx|scala|org\.junit|org\.opentest4j|org\.gradle|worker\.org\.gradle|org\.apache\.maven|org\.springframework|io\.micronaut|io\.quarkus)\./;

function jvmFrame(line: string): StackFrame | undefined {
	const match = JVM_FRAME.exec(line);
	if (!match) return undefined;
	const fn = match[2] as string;
	const where = match[3] as string;
	const place = JVM_LOCATION.exec(where);
	if (!place || !fn.includes(".")) return undefined;
	const module = match[1] ?? "";
	return {
		fn,
		...(place[1] ? { file: place[1] } : {}),
		...(place[2] ? { line: Number(place[2]) } : {}),
		internal: JVM_INTERNAL.test(fn) || /^(?:java|jdk)\./.test(module),
		text: line.trim(),
	};
}

const isJvmFrame = (line: string) => jvmFrame(line) !== undefined;

function jvmError(line: string): StackError {
	const match = JVM_ERROR.exec(line);
	if (!match) return { message: line.trim() };
	return { type: match[1] as string, message: (match[2] ?? "").trim() };
}

function parseJvm(lines: string[], first: number): StackTrace | null {
	const main: StackFrame[] = [];
	const causes: { error: StackError; frames: StackFrame[] }[] = [];
	let frames = main;
	let suppressed = false;
	for (let i = first; i < lines.length; i++) {
		const line = lines[i] as string;
		const cause = JVM_CAUSE.exec(line);
		if (cause) {
			suppressed = false;
			frames = [];
			causes.push({ error: jvmError(cause[1] as string), frames });
			continue;
		}
		if (/^\s*Suppressed: /.test(line)) {
			suppressed = true;
			continue;
		}
		if (JVM_MORE.test(line)) continue;
		const frame = jvmFrame(line);
		if (!frame) break;
		if (!suppressed && frames.length < MAX_FRAMES) frames.push(frame);
	}
	const error = errorAbove(lines, first, [JVM_ERROR]);
	const trace: StackTrace = { language: "jvm", error, frames: main };
	if (causes.length > 0) trace.causes = causes;
	return trace;
}

// Python --------------------------------------------------------------------

const PY_START = /^\s*Traceback \(most recent call last\):\s*$/;
const PY_FRAME = /^\s*File "(.+)", line (\d+)(?:, in (.+))?\s*$/;
const PY_CHAIN =
	/^\s*(?:During handling of the above exception, another exception occurred|The above exception was the direct cause of the following exception):\s*$/;
const PY_ERROR = /^((?:[\w]+\.)*[A-Z_a-z]\w*)(?:: (.*))?$/;

function isPyInternal(file: string): boolean {
	return (
		/[/\\](?:site|dist)-packages[/\\]/.test(file) ||
		/[/\\]lib[/\\]python\d+(?:\.\d+)?[/\\]/.test(file) ||
		/^<frozen /.test(file)
	);
}

/** One traceback block: its frames innermost first, its error, and the line after it. */
function pythonBlock(lines: string[], start: number) {
	const frames: StackFrame[] = [];
	let i = start + 1;
	for (; i < lines.length; i++) {
		const line = lines[i] as string;
		const frame = PY_FRAME.exec(line);
		if (frame) {
			const file = frame[1] as string;
			frames.push({
				...(frame[3] ? { fn: frame[3].trim() } : {}),
				file,
				line: Number(frame[2]),
				internal: isPyInternal(file),
				text: line.trim(),
			});
			continue;
		}
		// The quoted code and the `^^^^` markers under a frame are indented.
		if (/^\s/.test(line) || !line) continue;
		break;
	}
	const head = (lines[i] ?? "").trim();
	const message: string[] = [];
	let type: string | undefined;
	const match = PY_ERROR.exec(head);
	if (match && !/\s/.test(match[1] as string)) {
		type = match[1];
		message.push(match[2] ?? "");
	} else {
		message.push(head);
	}
	for (i++; i < lines.length; i++) {
		const line = lines[i] as string;
		if (!line.trim() || PY_CHAIN.test(line) || PY_START.test(line)) break;
		message.push(line);
	}
	frames.reverse();
	const error: StackError = type
		? { type, message: message.join("\n").trim() }
		: { message: message.join("\n").trim() };
	return { error, frames: frames.slice(0, MAX_FRAMES), next: i };
}

function parsePython(lines: string[], first: number): StackTrace | null {
	const blocks = [pythonBlock(lines, first)];
	let at = (blocks[0] as { next: number }).next;
	for (;;) {
		while (at < lines.length && !(lines[at] as string).trim()) at++;
		if (!PY_CHAIN.test(lines[at] ?? "")) break;
		at++;
		while (at < lines.length && !(lines[at] as string).trim()) at++;
		if (!PY_START.test(lines[at] ?? "")) break;
		const block = pythonBlock(lines, at);
		blocks.push(block);
		at = block.next;
	}
	const last = blocks.pop() as (typeof blocks)[number];
	const trace: StackTrace = {
		language: "python",
		error: last.error,
		frames: last.frames,
	};
	if (blocks.length > 0)
		trace.causes = blocks
			.reverse()
			.map(({ error, frames }) => ({ error, frames }));
	return trace;
}

// Go ------------------------------------------------------------------------

const GO_PANIC = /^(panic|fatal error): (.*)$/;
const GO_GOROUTINE = /^goroutine \d+ \[.*\]:\s*$/;
const GO_LOCATION = /^\t(.+?\.go|\?\?):(\d+)(?: \+0x[0-9a-f]+)?\s*$/;
const GO_STD =
	/^(?:(?:runtime|testing|reflect|sync|syscall|os|fmt|io|bufio|context|time|errors|strconv|net)[./]|(?:internal|encoding|net|crypto|database)\/)/;

function parseGo(lines: string[], first: number): StackTrace | null {
	const panic = GO_PANIC.exec(lines[first] as string);
	if (!panic) return null;
	const error: StackError = {
		type: panic[1] as string,
		message: (panic[2] as string).replace(/ \[recovered\]$/, "").trim(),
	};
	const routine = lines.findIndex(
		(line, at) => at > first && GO_GOROUTINE.test(line),
	);
	if (routine < 0) return { language: "go", error, frames: [] };
	const frames: StackFrame[] = [];
	for (
		let i = routine + 1;
		i + 1 < lines.length && frames.length < MAX_FRAMES;
		i += 2
	) {
		const call = lines[i] as string;
		const place = GO_LOCATION.exec(lines[i + 1] as string);
		if (!call.trim() || !place) break;
		const fn = call
			.trim()
			.replace(/ in goroutine \d+$/, "")
			.replace(/\((?:[^()]|\.\.\.)*\)$/, "");
		const name = fn.replace(/^created by /, "");
		const file = place[1] as string;
		frames.push({
			fn,
			file,
			line: Number(place[2]),
			internal: GO_STD.test(name) || /[/\\]pkg[/\\]mod[/\\]/.test(file),
			text: `${call.trim()} ${(lines[i + 1] as string).trim()}`,
		});
	}
	return { language: "go", error, frames };
}
