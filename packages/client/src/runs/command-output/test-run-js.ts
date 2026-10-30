/**
 * The JavaScript test runners: bun test, Vitest and Jest, from the text they
 * print to a terminal that is not a TTY (and to one that is, escapes gone).
 */

import { durationMs } from "./plain-lines";
import {
	countsOf,
	dedent,
	errorOf,
	RunBuilder,
	type TestCase,
	type TestRun,
	type TestStatus,
} from "./test-run-builder";

const TIME = String.raw`(\d+(?:\.\d+)?)\s?(ms|s)`;
const SCRIPT_FILE = String.raw`\S*\.(?:[cm]?[jt]sx?|vue|svelte)`;

/** `at fn (file:1:2)`, `at file:1:2`, `❯ file:1:2`: a frame of a JavaScript trace. */
const JS_FRAME = /^\s*(?:at\s|❯\s+\S+:\d+)/;

// bun test ------------------------------------------------------------------

const BUN_SIGNS = [
	/^bun test v\d/,
	/^\s*\((?:pass|fail|skip|todo)\) \S/,
	/^Ran \d+ tests? across \d+ files?\./,
];
const BUN_TEST = new RegExp(
	String.raw`^\s*(?:\((pass|fail|skip|todo)\)|([✓✔])|([✗✘×])|([»⏭])|(✎))\s+(.+?)(?:\s+\[${TIME}\])?\s*$`,
);
const BUN_FILE = new RegExp(`^(${SCRIPT_FILE}):$`);
const BUN_COUNT = /^\s*(\d+) (pass|fail|skip|todo|filtered out)\s*$/;
const BUN_RAN = /^Ran (\d+) tests? across (\d+) files?\.(?:\s+\[(.+)\])?/;
const BUN_LIST_END = /^\d+ tests? (?:failed|skipped|todo):?$/;

export function parseBun(lines: string[]): TestRun | null {
	if (!lines.some((line) => BUN_SIGNS.some((sign) => sign.test(line))))
		return null;
	const run = new RunBuilder();
	let suite = "";
	let pending: string[] = [];
	let listing = true;
	let counted = false;
	let oneFile = false;
	const files = new Set<string>();
	for (const line of lines) {
		const file = BUN_FILE.exec(line);
		if (file && listing) {
			suite = file[1] as string;
			run.suite(suite);
			files.add(suite);
			pending = [];
			continue;
		}
		const count = BUN_COUNT.exec(line);
		if (count) {
			listing = false;
			counted = true;
			const n = Number(count[1]);
			const word = count[2] as string;
			if (word === "filtered out") continue;
			run.addSummary({
				passed: word === "pass" ? n : 0,
				failed: word === "fail" ? n : 0,
				skipped: word === "skip" || word === "todo" ? n : 0,
			});
			continue;
		}
		const ran = BUN_RAN.exec(line);
		if (ran) {
			listing = false;
			if (!counted) run.addSummary({ passed: 0, failed: 0, skipped: 0 });
			if (ran[3]) run.durationMs = durationMs(ran[3]);
			oneFile = ran[2] === "1";
			continue;
		}
		if (BUN_LIST_END.test(line.trim())) {
			// The recap of failed or skipped tests repeats lines listed above.
			listing = false;
			continue;
		}
		const test = BUN_TEST.exec(line);
		if (test && listing) {
			const [, word, pass, fail, skip, todo, name, amount, unit] = test;
			const status: TestStatus =
				word === "pass" || pass
					? "passed"
					: word === "fail" || fail
						? "failed"
						: skip || todo || word
							? "skipped"
							: "passed";
			const added: TestCase = { name: name as string, status };
			if (amount) added.durationMs = durationMs(`${amount}${unit}`);
			if (status === "failed") {
				const error = bunError(pending);
				if (error) added.error = error;
			}
			run.add(suite, added);
			pending = [];
			continue;
		}
		if (listing) pending.push(line);
	}
	// bun lists only failed tests when it does not print to a terminal. With
	// one file, its summary is that file's counts.
	const [only] = files;
	if (oneFile && files.size === 1 && only !== undefined && run.summary)
		run.suite(only).counts = { ...run.summary };
	return run.finish("bun");
}

/** The error bun prints above a failed test: a code frame, `error: …`, then `at …` lines. */
function bunError(lines: string[]) {
	const start = lines.findIndex((line) =>
		/^(?:error|[A-Z]\w*(?:Error|Exception))(?::|$)/.test(line.trim()),
	);
	const body =
		start < 0 ? lines.filter((line) => !isCodeFrame(line)) : lines.slice(start);
	const message: string[] = [];
	const stack: string[] = [];
	for (const line of body) {
		if (stack.length > 0 || JS_FRAME.test(line)) {
			if (JS_FRAME.test(line)) stack.push(line);
			continue;
		}
		message.push(line);
	}
	if (message[0] !== undefined)
		message[0] = message[0].trim().replace(/^error:\s*/, "");
	return errorOf(message, stack);
}

/** `12 | code`, `> 12 | code` and the `^` under it: the code a runner quotes. */
function isCodeFrame(line: string): boolean {
	return /^\s*>?\s*\d+\s*\|/.test(line) || /^\s*\|?\s*\^+\s*$/.test(line);
}

// Vitest --------------------------------------------------------------------

const VITEST_SIGNS = [
	/^\s*RUN\s+v\d+\.\d+/,
	/^\s*Test Files\s+\d+ (?:passed|failed|skipped)/,
	/^\s*Tests\s+\d+ (?:passed|failed|skipped|todo)(?:\s*\|.*)?\s*\(\d+\)\s*$/,
	new RegExp(String.raw`^\s*[✓✔❯×✗↓√]\s+${SCRIPT_FILE}\s+\(\d+ tests?`),
];
const VITEST_FILE = new RegExp(
	String.raw`^ {0,2}([✓✔❯×✗↓√])\s+(?:\|[^|]+\|\s+)?(${SCRIPT_FILE})\s+\((\d+)(?: tests?)?((?:\s*\|\s*\d+ \w+)*)\)(?:\s+${TIME})?\s*$`,
);
const VITEST_TEST = new RegExp(
	String.raw`^(\s+)([✓✔×✗↓√])\s+(.+?)(?:\s+\((\d+)\))?(?:\s+${TIME})?\s*$`,
);
/** Vitest 3: `✓ src/a.test.ts > group > test`. */
const VITEST_FLAT = new RegExp(`^(${SCRIPT_FILE}) > (.+)$`);
const VITEST_FAIL = /^\s*FAIL\s+(\S+)(?:\s+>\s+(.+?))?(?:\s+\[.*\])?\s*$/;
const VITEST_RULE = /^⎯{2,}/;

export function parseVitest(lines: string[]): TestRun | null {
	if (!lines.some((line) => VITEST_SIGNS.some((sign) => sign.test(line))))
		return null;
	const run = new RunBuilder();
	let suite = "";
	let fileIndent = 0;
	/** The groups above the next test line in the tree of the verbose reporter. */
	let groups: { indent: number; name: string }[] = [];
	let last: TestCase | undefined;
	let section: "list" | "failures" | "other" = "list";
	let failure: { test: TestCase; lines: string[] } | undefined;

	const closeFailure = () => {
		if (!failure) return;
		const message: string[] = [];
		const stack: string[] = [];
		for (const line of dedent(failure.lines)) {
			if (JS_FRAME.test(line)) stack.push(line.trim());
			else if (stack.length === 0 && !isCodeFrame(line)) message.push(line);
		}
		const error = errorOf(trimDiff(message), stack);
		if (error) failure.test.error = error;
		failure = undefined;
	};

	for (const line of lines) {
		if (VITEST_RULE.test(line.trim())) {
			closeFailure();
			if (/Failed (?:Tests|Suites)/.test(line)) section = "failures";
			else if (/⎯ \w/.test(line)) section = "other";
			continue;
		}
		const tests = /^\s*Tests\s+(.+?)\s+\((\d+)\)\s*$/.exec(line);
		if (tests) {
			closeFailure();
			section = "other";
			run.addSummary(countsOf(tests[1] as string));
			continue;
		}
		const duration = /^\s*Duration\s+(\S+)/.exec(line);
		if (duration) {
			run.durationMs = durationMs(duration[1] as string);
			continue;
		}
		if (/^\s*Test Files\s/.test(line)) {
			section = "other";
			continue;
		}
		if (section === "failures") {
			const fail = VITEST_FAIL.exec(line);
			if (fail) {
				closeFailure();
				const file = fail[1] as string;
				const name = fail[2] ?? "Test file failed to run";
				failure = { test: run.failed(file, name), lines: [] };
				continue;
			}
			failure?.lines.push(line);
			continue;
		}
		if (section !== "list") continue;
		const file = VITEST_FILE.exec(line);
		if (file) {
			suite = file[2] as string;
			fileIndent = line.length - line.trimStart().length;
			groups = [];
			last = undefined;
			const counts = countsOf(file[4] ?? "");
			const total = Number(file[3]);
			counts.passed = Math.max(0, total - counts.failed - counts.skipped);
			run.addCounts(suite, counts);
			if (file[5])
				run.suite(suite).durationMs = durationMs(`${file[5]}${file[6]}`);
			continue;
		}
		const arrow = /^\s+→\s+(.*)$/.exec(line);
		if (arrow && last) {
			const message = arrow[1] as string;
			last.error = last.error
				? { ...last.error, message: `${last.error.message}\n${message}` }
				: { message };
			continue;
		}
		const test = VITEST_TEST.exec(line);
		if (test && line.length - line.trimStart().length > fileIndent) {
			const indent = (test[1] as string).length;
			const marker = test[2] as string;
			let name = test[3] as string;
			groups = groups.filter((group) => group.indent < indent);
			if (test[4] !== undefined) {
				// `✓ add (2)`: a group of the verbose tree, not a test.
				groups.push({ indent, name });
				continue;
			}
			let suiteName = suite;
			const flat = VITEST_FLAT.exec(name);
			if (flat) {
				suiteName = flat[1] as string;
				name = flat[2] as string;
			} else if (groups.length > 0) {
				name = [...groups.map((group) => group.name), name].join(" > ");
			}
			const status: TestStatus =
				marker === "×" || marker === "✗"
					? "failed"
					: marker === "↓"
						? "skipped"
						: "passed";
			last = { name, status };
			if (test[5]) last.durationMs = durationMs(`${test[5]}${test[6]}`);
			run.add(suiteName, last);
		}
	}
	closeFailure();
	return run.finish("vitest");
}

/** A message up to the expected/received diff Vitest prints under it. */
function trimDiff(message: string[]): string[] {
	const out: string[] = [];
	for (const line of message) {
		if (out.length > 0 && !line.trim()) break;
		out.push(line);
	}
	return out;
}

// Jest ----------------------------------------------------------------------

const JEST_SIGNS = [
	/^\s*(?:PASS|FAIL)\s+\S+\.[cm]?[jt]sx?\b/,
	/^Tests:\s+.*\d+ total/,
	/^Test Suites:\s+.*\d+ total/,
];
const JEST_SUITE = new RegExp(
	String.raw`^\s*(PASS|FAIL)\s+(?:\S+\s+)?(${SCRIPT_FILE})(?:\s+\(${TIME}\))?\s*$`,
);
const JEST_TEST = new RegExp(
	String.raw`^(\s+)([✓✔✕✗×○✎√])\s+(?:(skipped|todo)\s+)?(.+?)(?:\s+\(${TIME}\))?\s*$`,
);
const JEST_FAILURE = /^\s+● (.+)$/;

export function parseJest(lines: string[]): TestRun | null {
	if (!lines.some((line) => JEST_SIGNS.some((sign) => sign.test(line))))
		return null;
	const run = new RunBuilder();
	let suite = "";
	let groups: { indent: number; name: string }[] = [];
	let recap = false;
	let failure: { test: TestCase; lines: string[] } | undefined;

	const closeFailure = () => {
		if (!failure) return;
		const message: string[] = [];
		const stack: string[] = [];
		for (const line of failure.lines) {
			if (/^\s*at\s/.test(line)) stack.push(line);
			else if (stack.length === 0 && !isCodeFrame(line)) message.push(line);
		}
		const error = errorOf(message, stack);
		if (error && !failure.test.error) failure.test.error = error;
		failure = undefined;
	};

	for (const line of lines) {
		if (/^Summary of all failing tests/.test(line.trim())) {
			closeFailure();
			recap = true;
			continue;
		}
		const tests = /^Tests:\s+(.+)$/.exec(line);
		if (tests) {
			closeFailure();
			recap = false;
			run.addSummary(countsOf(tests[1] as string));
			continue;
		}
		const time = /^Time:\s+([^,]+)/.exec(line);
		if (time) {
			run.durationMs = durationMs(time[1] as string);
			continue;
		}
		if (/^(?:Test Suites|Snapshots):/.test(line)) {
			closeFailure();
			continue;
		}
		if (recap) continue;
		const head = JEST_SUITE.exec(line);
		if (head) {
			closeFailure();
			suite = head[2] as string;
			run.suite(suite);
			if (head[3])
				run.suite(suite).durationMs = durationMs(`${head[3]}${head[4]}`);
			groups = [];
			continue;
		}
		const failed = JEST_FAILURE.exec(line);
		if (failed) {
			closeFailure();
			failure = { test: run.failed(suite, failed[1] as string), lines: [] };
			continue;
		}
		if (failure) {
			failure.lines.push(line);
			continue;
		}
		const test = JEST_TEST.exec(line);
		if (test) {
			const indent = (test[1] as string).length;
			groups = groups.filter((group) => group.indent < indent);
			const marker = test[2] as string;
			const name = [
				...groups.map((group) => group.name),
				test[4] as string,
			].join(" › ");
			const status: TestStatus =
				marker === "✕" || marker === "✗" || marker === "×"
					? "failed"
					: marker === "○" || marker === "✎" || test[3]
						? "skipped"
						: "passed";
			const added: TestCase = { name, status };
			if (test[5]) added.durationMs = durationMs(`${test[5]}${test[6]}`);
			run.add(suite, added);
			continue;
		}
		const group = /^(\s{2,})(\S.*?)\s*$/.exec(line);
		if (group && suite && !/^(?:console\.\w+|at\s)/.test(group[2] as string)) {
			const indent = (group[1] as string).length;
			groups = groups.filter((known) => known.indent < indent);
			groups.push({ indent, name: group[2] as string });
		}
	}
	closeFailure();
	return run.finish("jest");
}
