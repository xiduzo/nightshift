/**
 * pytest, from its default output (a row of dots per file) and from `-v`
 * (a line per test). The dots give counts only; the names of failed tests
 * come from the failure report and the short summary.
 */

import { durationMs } from "./plain-lines";
import {
	countsOf,
	dedent,
	errorOf,
	noCounts,
	RunBuilder,
	type TestCase,
	type TestRun,
	type TestStatus,
} from "./test-run-builder";

const SECTION = /^=+ (.+?) =+$/;
const SUMMARY =
	/^=+ ((?:\d+ (?:passed|failed|skipped|errors?|xfailed|xpassed|warnings?|deselected|rerun)(?:, )?)+|no tests ran) in (\d+(?:\.\d+)?s)(?: \([^)]*\))? =+$/;
const SIGNS = [
	/^=+ test session starts =+$/,
	SUMMARY,
	/^\S+\.py::\S.*\s(?:PASSED|FAILED|SKIPPED|ERROR|XFAIL|XPASS)\b/,
];
const PROGRESS = /^(\S+\.py) ([.FEsxX]+)\s*(?:\[\s*\d+%\])?\s*$/;
const VERBOSE =
	/^(\S+\.py)::(\S.*?) (PASSED|FAILED|SKIPPED|ERROR|XFAIL|XPASS)\b(?:.*?)\s*(?:\[\s*\d+%\])?\s*$/;
const SHORT = /^(FAILED|ERROR) (\S+?\.py)(?:::(\S.*?))?(?: - (.*))?$/;
const BLOCK = /^_{3,} (.+?) _{3,}$/;
const LOCATION = /^(\S+\.py):\d+: /;

const STATUS: Record<string, TestStatus> = {
	PASSED: "passed",
	XPASS: "passed",
	FAILED: "failed",
	ERROR: "failed",
	SKIPPED: "skipped",
	XFAIL: "skipped",
};

/** The name of the one failed test of a file that could not be collected. */
const COLLECTING = "Test file failed to run";

type Block = { name: string; file?: string; lines: string[] };

/**
 * `TestCalc::test_divide` and `TestCalc.test_divide` name the same test. A
 * file that could not be collected has one test, known by its file.
 */
const key = (file: string | undefined, name: string) =>
	name === COLLECTING ? `${file}::${name}` : name.replace(/::/g, ".");

export function parsePytest(lines: string[]): TestRun | null {
	if (!lines.some((line) => SIGNS.some((sign) => sign.test(line)))) return null;
	const run = new RunBuilder();
	const byName = new Map<string, TestCase>();
	const blocks: Block[] = [];
	let section = "";
	let block: Block | undefined;

	const record = (file: string, test: TestCase) => {
		byName.set(key(file, test.name), test);
		return test;
	};

	for (const line of lines) {
		const summary = SUMMARY.exec(line);
		if (summary) {
			block = undefined;
			run.addSummary(
				summary[1] === "no tests ran"
					? noCounts()
					: countsOf(summary[1] as string),
			);
			run.durationMs = durationMs(summary[2] as string);
			continue;
		}
		const heading = SECTION.exec(line);
		if (heading) {
			block = undefined;
			section = (heading[1] as string).toLowerCase();
			continue;
		}
		if (section === "failures" || section === "errors") {
			const start = BLOCK.exec(line);
			if (start) {
				const title = start[1] as string;
				const collecting = /^ERROR collecting (\S+\.py)$/.exec(title);
				block = collecting
					? { name: COLLECTING, file: collecting[1], lines: [] }
					: {
							name: title.replace(/^ERROR at (?:setup|teardown) of /, ""),
							lines: [],
						};
				blocks.push(block);
				continue;
			}
			block?.lines.push(line);
			continue;
		}
		const short = SHORT.exec(line);
		if (short && section === "short test summary info") {
			const file = short[2] as string;
			const name = short[3] ?? COLLECTING;
			const test =
				byName.get(key(file, name)) ?? record(file, run.failed(file, name));
			test.status = "failed";
			if (short[4] && !test.error) test.error = { message: short[4] };
			continue;
		}
		const verbose = VERBOSE.exec(line);
		if (verbose) {
			const file = verbose[1] as string;
			const name = verbose[2] as string;
			const status = STATUS[verbose[3] as string] ?? "passed";
			const known = byName.get(key(file, name));
			if (known) known.status = status;
			else record(file, run.add(file, { name, status }));
			continue;
		}
		const progress = PROGRESS.exec(line);
		if (progress) {
			const counts = noCounts();
			for (const mark of progress[2] as string) {
				if (mark === "." || mark === "X") counts.passed++;
				else if (mark === "F" || mark === "E") counts.failed++;
				else counts.skipped++;
			}
			run.addCounts(progress[1] as string, counts);
		}
	}

	for (const { name, lines: body, ...where } of blocks) {
		let file = where.file;
		for (const line of body) file ??= LOCATION.exec(line)?.[1];
		let test = byName.get(key(file, name));
		if (!test) {
			if (!file) continue;
			test = record(file, run.failed(file, name));
		}
		const message = body
			.filter((line) => /^E\s/.test(line))
			.map((line) => line.replace(/^E\s{1,7}/, ""));
		const error = errorOf(
			message.length > 0 ? message : body.slice(-1),
			dedent(body),
		);
		if (error) test.error = error;
	}
	return run.finish("pytest");
}
