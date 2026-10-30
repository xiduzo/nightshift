/**
 * The JVM test runners: Gradle's console output (`> Task :test`, a line per
 * test event it logs, `N tests completed, M failed`) and Maven Surefire
 * (`Running <class>`, `Tests run: …` per class and for the build). Both list
 * the failed tests by name and count the rest.
 */

import { durationMs } from "./plain-lines";
import {
	errorOf,
	RunBuilder,
	type TestCase,
	type TestRun,
	type TestStatus,
} from "./test-run-builder";

const JVM_FRAME = /^\s*at\s|^\s*\.\.\. \d+ more$/;

// Gradle --------------------------------------------------------------------

const GRADLE_TASK = /^> Task :(?:\S+:)?test\w*(?:\s|$)/i;
const GRADLE_TEST = /^(\S[^>]*?) > (.+) (PASSED|FAILED|SKIPPED)\s*$/;
const GRADLE_SUMMARY =
	/^(\d+) tests? completed(?:, (\d+) failed)?(?:, (\d+) skipped)?/;
const GRADLE_BUILD = /^BUILD (?:SUCCESSFUL|FAILED) in (.+)$/;

const GRADLE_STATUS: Record<string, TestStatus> = {
	PASSED: "passed",
	FAILED: "failed",
	SKIPPED: "skipped",
};

export function parseGradle(lines: string[]): TestRun | null {
	if (
		!lines.some((line) => GRADLE_TASK.test(line)) &&
		!lines.some((line) => GRADLE_SUMMARY.test(line))
	)
		return null;
	if (
		!lines.some((line) => GRADLE_TEST.test(line) || GRADLE_SUMMARY.test(line))
	)
		return null;
	const run = new RunBuilder();
	let failed: { test: TestCase; lines: string[] } | undefined;

	const close = () => {
		if (!failed) return;
		const error = jvmError(failed.lines);
		if (error) failed.test.error = error;
		failed = undefined;
	};

	for (const line of lines) {
		if (failed) {
			if (/^\s+\S/.test(line)) {
				failed.lines.push(line);
				continue;
			}
			close();
		}
		const test = GRADLE_TEST.exec(line);
		if (test) {
			const suite = (test[1] as string).trim();
			const status = GRADLE_STATUS[test[3] as string] ?? "passed";
			const added = run.add(suite, { name: test[2] as string, status });
			if (status === "failed") failed = { test: added, lines: [] };
			continue;
		}
		const summary = GRADLE_SUMMARY.exec(line);
		if (summary) {
			const total = Number(summary[1]);
			const fail = Number(summary[2] ?? 0);
			const skip = Number(summary[3] ?? 0);
			run.addSummary({
				passed: Math.max(0, total - fail - skip),
				failed: fail,
				skipped: skip,
			});
			continue;
		}
		const build = GRADLE_BUILD.exec(line);
		if (build) {
			run.durationMs = durationMs(build[1] as string);
			run.ended = true;
		}
	}
	close();
	return run.finish("gradle");
}

/** The exception under a failed test: its first lines are the message, `at …` lines the trace. */
function jvmError(lines: string[]) {
	const message: string[] = [];
	const stack: string[] = [];
	for (const line of lines) {
		if (stack.length > 0 || JVM_FRAME.test(line)) stack.push(line);
		else message.push(line);
	}
	return errorOf(message, stack);
}

// Maven Surefire ------------------------------------------------------------

const MAVEN_LEVEL = /^\[(?:INFO|ERROR|WARNING|WARN|DEBUG)\] ?/;
const MAVEN_SIGNS = [/^\s*T E S T S\s*$/, /^Tests run: \d+, Failures: \d+/];
const MAVEN_RUNNING = /^Running (\S+)\s*$/;
const MAVEN_COUNTS =
	/^Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)(?:, Time elapsed: ([\d.,]+) ?s(?:ec)?)?(.*)$/;
/** Surefire 3: `com.example.CalcTest.divides -- Time elapsed: 0.010 s <<< FAILURE!` */
const MAVEN_FAILED =
	/^([\w.$]+)\.([^.]+?) -- Time elapsed: [\d.,]+ ?s <<< (?:FAILURE|ERROR)!\s*$/;
/** Surefire 2: `divides(com.example.CalcTest)  Time elapsed: 0.01 sec  <<< FAILURE!` */
const MAVEN_FAILED_OLD =
	/^(.+?)\(([\w.$]+)\)\s+Time elapsed: [\d.,]+ ?s(?:ec)?\s+<<< (?:FAILURE|ERROR)!\s*$/;
const MAVEN_TIME = /^Total time:\s+(.+?)\s*$/;

export function parseMaven(raw: string[]): TestRun | null {
	const lines = raw.map((line) => line.replace(MAVEN_LEVEL, ""));
	if (!lines.some((line) => MAVEN_SIGNS.some((sign) => sign.test(line))))
		return null;
	const run = new RunBuilder();
	let suite = "";
	let results = false;
	let failed: { test: TestCase; lines: string[] } | undefined;

	const close = () => {
		if (!failed) return;
		const error = jvmError(failed.lines);
		if (error) failed.test.error = error;
		failed = undefined;
	};

	for (const line of lines) {
		if (failed) {
			if (
				line.trim() &&
				!MAVEN_RUNNING.test(line) &&
				!MAVEN_COUNTS.test(line)
			) {
				failed.lines.push(line);
				continue;
			}
			close();
		}
		const running = MAVEN_RUNNING.exec(line);
		if (running) {
			suite = running[1] as string;
			run.suite(suite);
			results = false;
			continue;
		}
		if (/^Results\s*:\s*$/.test(line)) {
			results = true;
			continue;
		}
		const counts = MAVEN_COUNTS.exec(line);
		if (counts) {
			const total = Number(counts[1]);
			const fail = Number(counts[2]) + Number(counts[3]);
			const skip = Number(counts[4]);
			const parsed = {
				passed: Math.max(0, total - fail - skip),
				failed: fail,
				skipped: skip,
			};
			const owner = / in ([\w.$]+)\s*$/.exec(counts[6] ?? "")?.[1];
			if (owner || (!results && counts[5] !== undefined)) {
				const name = owner ?? suite;
				run.addCounts(name, parsed);
				if (counts[5]) {
					run.suite(name).durationMs = durationMs(
						`${(counts[5] as string).replace(",", ".")}s`,
					);
				}
			} else {
				run.addSummary(parsed);
			}
			continue;
		}
		const fail = MAVEN_FAILED.exec(line);
		const old = fail ? undefined : MAVEN_FAILED_OLD.exec(line);
		if (fail || old) {
			const owner = (fail ? fail[1] : old?.[2]) as string;
			const name = (fail ? fail[2] : old?.[1]) as string;
			failed = { test: run.failed(owner, name), lines: [] };
			continue;
		}
		const time = MAVEN_TIME.exec(line);
		if (time) {
			run.durationMs = mavenTime(time[1] as string);
			run.ended = true;
		}
	}
	close();
	return run.finish("maven");
}

/** `2.345 s`, `01:05 min`, `1:02 h` as milliseconds. */
function mavenTime(text: string): number | undefined {
	const clock = /^(\d+):(\d+)(?::(\d+))? (min|h)$/.exec(text);
	if (!clock) return durationMs(text);
	const [, a, b, c, unit] = clock;
	return unit === "h"
		? (Number(a) * 3600 + Number(b) * 60 + Number(c ?? 0)) * 1000
		: (Number(a) * 60 + Number(b)) * 1000;
}
