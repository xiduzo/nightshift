/**
 * A command's output read as test results or as an error with its trace.
 * Parsing waits for a quiet moment while output streams in (a deferred
 * value), runs once per output (memo), and skips a long output nobody looks at.
 */
import {
	parseStackTrace,
	parseTestRun,
	type StackTrace,
	type TestRun,
} from "@nightshift/client";
import { useDeferredValue, useMemo } from "react";

/** Output up to this long is read even while its terminal is closed: its title says how the tests went. */
const EAGER_CHARS = 100_000;

/**
 * The test run in `output`, or null when it is none. A long output is read
 * only while `open`.
 */
export function useTestRun(
	output: string | undefined,
	open: boolean,
): TestRun | null {
	const deferred = useDeferredValue(output);
	const read =
		deferred !== undefined && (open || deferred.length <= EAGER_CHARS);
	return useMemo(
		() => (read && deferred ? parseTestRun(deferred) : null),
		[read, deferred],
	);
}

/** The first stack trace in `output`, when `output` is given. */
export function useStackTrace(output: string | undefined): StackTrace | null {
	const deferred = useDeferredValue(output);
	return useMemo(
		() => (deferred ? parseStackTrace(deferred) : null),
		[deferred],
	);
}
