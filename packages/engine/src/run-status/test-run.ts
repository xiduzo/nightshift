/**
 * A test run (ADR 27): a person started it from the editor with pinned or
 * skipped nodes. It keeps nothing that lasts. Its spend counts in the
 * numbers. Every other number leaves it out: Flow health, Needed you, the
 * useful answers and the Latest reports. The read model, the dashboard and
 * every screen ask this one question.
 *
 * A run summary names the test as `test` (absent: no test run). The run
 * state of the log names it too (null: no test run).
 */
export function isTestRun<T extends { test?: unknown }>(
	run: T,
): run is T & { test: NonNullable<T["test"]> } {
	return run.test !== undefined && run.test !== null;
}
