import { calledFlows } from "./called-flows";
import type { RunDetail, StepSummary } from "./views";

/**
 * What an assistant reads in a run's detail beyond its fields: the chat
 * in the editor, Ask why and `nightshift mcp`. The detail holds each fact.
 * The view does not name it, so each reader derived it again.
 */
export type RunReading = {
	/** The called flow each step ran in, by step id. Null: the run's own flow. */
	flowOf: ReadonlyMap<string, string | null>;
	/**
	 * The step the run failed or stopped at, or null: the last one that
	 * ended badly. Inside a called flow: that step, not the Subflow step
	 * that failed because of it.
	 */
	failedStep: StepSummary | null;
};

/** Step outcomes that end a run badly. */
const BAD = new Set<string>([
	"fail",
	"needs-input",
	"error",
	"stopped",
	"interrupted",
]);

/** The facts an assistant reads in a run's detail (`RunReading`). */
export function runReading(
	detail: Pick<RunDetail, "flow" | "calledFlows" | "steps">,
): RunReading {
	const { steps } = detail;
	const { ranIn } = calledFlows(steps, () => detail);
	const bad = steps.filter(
		(step) =>
			step.error !== null || (step.outcome !== null && BAD.has(step.outcome)),
	);
	// A Subflow step that failed because a step inside it did is not the cause.
	const parents = new Set(
		bad.flatMap((step) => (step.scope ? [step.scope.parentStepId] : [])),
	);
	return {
		flowOf: new Map(steps.map((step) => [step.id, ranIn(step)])),
		failedStep: bad.findLast((step) => !parents.has(step.id)) ?? null,
	};
}
