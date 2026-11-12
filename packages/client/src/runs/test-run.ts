/**
 * A test run (ADR 27) on every screen: a run a person started from the
 * editor with pinned or skipped nodes. The engine's one rule tells it
 * apart (`isTestRun`). Its spend counts in the numbers. Flow health,
 * Needed you, Latest reports and the useful question leave it out.
 */

import type { StepSummary } from "./types";

export { isTestRun } from "@nightshift/engine/run-status";

/** The badge of a test run, on the web and on the phone. */
export const TEST_RUN_LABEL = "Test run";

/** What the badge means. */
export const TEST_RUN_HINT =
	"You started it from the editor with pinned or skipped nodes. Only its spend counts in your numbers.";

/** What a step that stood in for its node says: its node did not run. */
export function standInLabel(test: NonNullable<StepSummary["test"]>): string {
	return test === "pinned" ? "Pinned output" : "Skipped";
}
