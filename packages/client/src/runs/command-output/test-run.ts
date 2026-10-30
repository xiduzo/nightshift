/**
 * A command's output as a test run, when it is one: which runner, the suites
 * and tests it lists, and what it adds up to. Each runner's parser looks for
 * its own signs first and gives up early, so an output that is no test run
 * costs a few scans of its lines.
 */

import { plainLines } from "./plain-lines";
import type { TestRun } from "./test-run-builder";
import { parseBun, parseJest, parseVitest } from "./test-run-js";
import { parseGradle, parseMaven } from "./test-run-jvm";
import { parseCargo, parseGo } from "./test-run-native";
import { parsePytest } from "./test-run-python";

export type {
	TestCase,
	TestCounts,
	TestError,
	TestRun,
	TestRunner,
	TestStatus,
	TestSuite,
} from "./test-run-builder";

/** A test run names its files at the start and sums up at the end: read both ends of a long one. */
const SCAN = { head: 256_000, tail: 768_000 };

/** In order: when an output shows the signs of two runners, the first one reads it. */
const PARSERS = [
	parseBun,
	parseVitest,
	parseJest,
	parsePytest,
	parseGradle,
	parseMaven,
	parseGo,
	parseCargo,
];

/**
 * The test run in `output`, or null when it is not one. Output that is still
 * coming gives what it has so far, with `complete` false. When the output
 * only sums up, the suites are empty: no test is made up.
 */
export function parseTestRun(output: string): TestRun | null {
	if (!output) return null;
	const lines = plainLines(output, SCAN);
	for (const parse of PARSERS) {
		const run = parse(lines);
		if (run) return run;
	}
	return null;
}
