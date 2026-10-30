/**
 * The test runners of compiled languages: `go test` (with and without `-v`)
 * and `cargo test`. Go prints no counts, so its summary adds up the tests it
 * lists; cargo prints a result line per test target.
 */

import { durationMs } from "./plain-lines";
import {
	dedent,
	errorOf,
	RunBuilder,
	type TestCase,
	type TestRun,
	type TestStatus,
} from "./test-run-builder";

// go test -------------------------------------------------------------------

const GO_RESULT = /^(\s*)--- (PASS|FAIL|SKIP): (\S+) \((\d+(?:\.\d+)?)s\)/;
const GO_EVENT = /^=== (?:RUN|CONT|NAME|PAUSE)\s+(\S+)/;
const GO_PACKAGE =
	/^(ok|FAIL)\s+(\S+)\s+(?:(\d+(?:\.\d+)?s)|\(cached\)|\[(build failed|setup failed)\])/;
const GO_NO_FILES = /^\?\s+\S+\s+\[no test files\]/;
const GO_SIGNS = [GO_RESULT, GO_PACKAGE, /^=== RUN\s/];
const GO_STATUS: Record<string, TestStatus> = {
	PASS: "passed",
	FAIL: "failed",
	SKIP: "skipped",
};

export function parseGo(lines: string[]): TestRun | null {
	if (!lines.some((line) => GO_SIGNS.some((sign) => sign.test(line))))
		return null;
	const run = new RunBuilder();
	/** Tests of the package whose result line has not come yet. */
	let waiting: TestCase[] = [];
	/** What each running test printed, for `-v`, where output comes before the result. */
	const printed = new Map<string, string[]>();
	let current: string | undefined;
	let after: { test: TestCase; indent: number; lines: string[] } | undefined;
	/** Tests that started and have no result yet. */
	const running = new Set<string>();
	let packages = 0;

	const close = () => {
		if (!after) return;
		const own = printed.get(after.test.name) ?? [];
		const error = goError([...own, ...after.lines]);
		if (error) after.test.error = error;
		after = undefined;
	};

	for (const line of lines) {
		if (after) {
			const indent = line.length - line.trimStart().length;
			const panic = after.lines.some((known) => /^\s*panic: /.test(known));
			const goes =
				(line.trim() && indent > after.indent && !GO_RESULT.test(line)) ||
				/^panic: /.test(line) ||
				(panic &&
					!/^(?:FAIL|PASS|ok|exit status \d+)\b/.test(line) &&
					!GO_EVENT.test(line) &&
					!GO_RESULT.test(line));
			if (goes) {
				after.lines.push(line);
				continue;
			}
			close();
		}
		const event = GO_EVENT.exec(line);
		if (event) {
			current = event[1];
			if (line.startsWith("=== RUN")) running.add(current as string);
			continue;
		}
		const result = GO_RESULT.exec(line);
		if (result) {
			const name = result[3] as string;
			running.delete(name);
			const status = GO_STATUS[result[2] as string] ?? "passed";
			const test: TestCase = {
				name,
				status,
				durationMs: durationMs(`${result[4]}s`),
			};
			waiting.push(test);
			if (status === "failed")
				after = { test, indent: (result[1] as string).length, lines: [] };
			continue;
		}
		const pkg = GO_PACKAGE.exec(line);
		if (pkg) {
			const name = pkg[2] as string;
			const suite = run.suite(name);
			for (const test of withoutParents(waiting)) suite.tests.push(test);
			if (pkg[4]) suite.tests.push({ name: "Build failed", status: "failed" });
			if (pkg[3]) suite.durationMs = durationMs(pkg[3]);
			if (suite.tests.length === 0)
				run.addCounts(name, { passed: 0, failed: 0, skipped: 0 });
			waiting = [];
			printed.clear();
			running.clear();
			packages++;
			continue;
		}
		if (GO_NO_FILES.test(line)) continue;
		if (current && /^\s+\S/.test(line)) {
			const own = printed.get(current) ?? [];
			own.push(line);
			printed.set(current, own);
		}
	}
	close();
	if (waiting.length > 0) {
		const suite = run.suite("");
		for (const test of withoutParents(waiting)) suite.tests.push(test);
	}
	run.ended = packages > 0 && waiting.length === 0 && running.size === 0;
	return run.finish("go");
}

/** A test with subtests is their sum: list the subtests only. */
function withoutParents(tests: TestCase[]): TestCase[] {
	return tests.filter(
		(test) => !tests.some((other) => other.name.startsWith(`${test.name}/`)),
	);
}

/** What a failed Go test printed: its log lines, or a panic and its goroutine trace. */
function goError(lines: string[]) {
	const body = dedent(lines);
	const at = body.findIndex((line) => /^goroutine \d+ \[/.test(line));
	if (at < 0) return errorOf(body);
	return errorOf(body.slice(0, at), body.slice(at));
}

// cargo test ----------------------------------------------------------------

const CARGO_RUNNING = /^\s*Running (?:unittests )?(\S+)(?: \(.+\))?\s*$/;
const CARGO_DOCTESTS = /^\s*Doc-tests (\S+)\s*$/;
const CARGO_START = /^running (\d+) tests?$/;
const CARGO_TEST = /^test (.+?) \.\.\. (ok|FAILED|ignored)\b/;
const CARGO_OUTPUT = /^---- (.+?) std(?:out|err) ----$/;
const CARGO_RESULT =
	/^test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; \d+ measured; \d+ filtered out(?:; finished in (\d+(?:\.\d+)?s))?/;
const CARGO_SIGNS = [CARGO_START, CARGO_RESULT];

export function parseCargo(lines: string[]): TestRun | null {
	if (!lines.some((line) => CARGO_SIGNS.some((sign) => sign.test(line))))
		return null;
	if (!lines.some((line) => CARGO_TEST.test(line) || CARGO_RESULT.test(line)))
		return null;
	const run = new RunBuilder();
	let suite = "";
	let open = false;
	let output: { name: string; lines: string[] } | undefined;
	let duration: number | undefined;

	const close = () => {
		if (!output) return;
		const test = run.find(suite, output.name) ?? run.failed(suite, output.name);
		const body = dedent(
			output.lines.filter(
				(line) => !/^note: run with `RUST_BACKTRACE/.test(line),
			),
		);
		const at = body.findIndex((line) => /^stack backtrace:/.test(line));
		const error =
			at < 0 ? errorOf(body) : errorOf(body.slice(0, at), body.slice(at + 1));
		if (error) test.error = error;
		output = undefined;
	};

	for (const line of lines) {
		const target = CARGO_RUNNING.exec(line) ?? CARGO_DOCTESTS.exec(line);
		if (target) {
			close();
			suite = CARGO_DOCTESTS.test(line)
				? `Doc-tests ${target[1]}`
				: (target[1] as string);
			continue;
		}
		if (CARGO_START.test(line)) {
			close();
			open = true;
			run.suite(suite);
			continue;
		}
		const test = CARGO_TEST.exec(line);
		if (test) {
			const word = test[2] as string;
			const status: TestStatus =
				word === "ok" ? "passed" : word === "FAILED" ? "failed" : "skipped";
			const known = run.find(suite, test[1] as string);
			if (known) known.status = status;
			else run.add(suite, { name: test[1] as string, status });
			continue;
		}
		const start = CARGO_OUTPUT.exec(line);
		if (start) {
			close();
			output = { name: start[1] as string, lines: [] };
			continue;
		}
		const result = CARGO_RESULT.exec(line);
		if (result) {
			close();
			open = false;
			run.addSummary({
				passed: Number(result[1]),
				failed: Number(result[2]),
				skipped: Number(result[3]),
			});
			const took = result[4] ? durationMs(result[4]) : undefined;
			if (took !== undefined) duration = (duration ?? 0) + took;
			continue;
		}
		if (output) {
			if (/^failures:$/.test(line)) close();
			else output.lines.push(line);
		}
	}
	close();
	if (duration !== undefined)
		run.durationMs = Math.round(duration * 1000) / 1000;
	if (open) run.ended = false;
	return run.finish("cargo");
}
