import { METRIC } from "@nightshift/semconv";

/** What the rules of the run export write: spans of a run's trace, and metric points. */

/** The attributes of a span or a point. */
export type RecordAttributes = Record<
	string,
	string | number | boolean | undefined
>;

/**
 * The instruments of the run export, in the order they are made: each with
 * its registry metric, its kind and its description.
 */
export const INSTRUMENTS = {
	workflowDuration: {
		metric: METRIC.workflowDuration,
		kind: "histogram",
		description: "How long a run took, start to end.",
	},
	agentDuration: {
		metric: METRIC.agentDuration,
		kind: "histogram",
		description: "How long an Agent step took.",
	},
	stepDuration: {
		metric: METRIC.stepDuration,
		kind: "histogram",
		description: "How long a step other than an Agent took.",
	},
	cost: {
		metric: METRIC.cost,
		kind: "counter",
		description: "What runs cost, in USD.",
	},
	inputTokens: {
		metric: METRIC.inputTokens,
		kind: "counter",
		description: "Input tokens a session used.",
	},
	outputTokens: {
		metric: METRIC.outputTokens,
		kind: "counter",
		description: "Output tokens a session used.",
	},
	cacheReadTokens: {
		metric: METRIC.cacheReadTokens,
		kind: "counter",
		description: "Cache-read input tokens a session used.",
	},
	cacheWriteTokens: {
		metric: METRIC.cacheWriteTokens,
		kind: "counter",
		description: "Cache-write input tokens a session used.",
	},
	retries: {
		metric: METRIC.retries,
		kind: "counter",
		description: "Steps that ran again: a visit after the first.",
	},
	gateWait: {
		metric: METRIC.gateWait,
		kind: "histogram",
		description: "How long a Gate waited for a person.",
	},
	runOutcome: {
		metric: METRIC.runOutcome,
		kind: "counter",
		description: "Runs that ended, by how they ended.",
	},
	score: {
		metric: METRIC.score,
		kind: "counter",
		description:
			"Feedback on runs: Gate answers, useful answers, and what became of a pull request.",
	},
	ladderRung: {
		metric: METRIC.ladderRung,
		kind: "counter",
		description:
			"Where the work landed: one point for each climb that landed, by its ladder and rung.",
	},
	flowMetric: {
		metric: METRIC.flowMetric,
		kind: "histogram",
		description: "The numbers a flow reports.",
	},
} as const satisfies Record<
	string,
	{
		metric: { name: string; unit: string };
		kind: "histogram" | "counter";
		description: string;
	}
>;

export type InstrumentName = keyof typeof INSTRUMENTS;

/**
 * A span of a run, named by the ids it is worked out from: the run's first
 * walk, a step's first part, a later part of a run or a step (`seq` is the
 * event that ended it), or something inside a step (a Gate's wait, a sleep).
 */
export type SpanKey =
	| { of: "run"; runId: string }
	| { of: "step"; stepId: string }
	| { of: "later"; id: string; seq: number }
	| { of: "inner"; stepId: string; what: "gate" | "wait"; from: number };

/** What one landed fact writes, in order: spans of the run's trace, and points. */
export type RunRecord =
	| {
			kind: "span";
			name: string;
			/** The run whose trace it is in. */
			runId: string;
			span: SpanKey;
			/** Null: the trace's root. */
			parent: SpanKey | null;
			from: number;
			to: number;
			attributes: RecordAttributes;
			/** Marks the span failed, with this message. Absent: not said. */
			error?: string | null;
	  }
	| {
			kind: "point";
			instrument: InstrumentName;
			value: number;
			attributes: RecordAttributes;
	  };
