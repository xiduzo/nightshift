import { defaultDeciderModel } from "../decider/decider";
import { harnessFacts } from "../harnesses/facts";
import type {
	AgentErrorKind,
	AgentEvent,
	AgentHarness,
	AgentSessionInput,
	AgentUsage,
	Decider,
	DecisionInput,
	DecisionResult,
	SessionLimit,
	StepReportOutcome,
	ValueInput,
	ValueResult,
} from "../port/types";

/** One step of a scripted fake session. */
export type FakeStep =
	| {
			type: "text";
			text: string /** Characters per delta. Default 8. */;
			chunkSize?: number;
	  }
	/**
	 * A tool call. When the session's `tools` has one of that name (Night
	 * Shift's own, bridged), the fake runs it with `input` and its answer is
	 * the result, as over the real bridge. Else the result is `result`.
	 */
	| { type: "tool"; name: string; input?: unknown; result?: string }
	/**
	 * The agent's step report: one `report` event. `data` is passed on as is
	 * (the fake never checks it against a spec, like the real harness).
	 */
	| {
			type: "report";
			outcome: StepReportOutcome;
			summary: string;
			data?: unknown;
	  }
	| { type: "wait"; ms: number }
	/** What the session has used so far: one `usage` event. */
	| { type: "usage"; usage: AgentUsage };

export type FakeOutcome =
	| {
			type: "finished";
			usage?: AgentUsage;
			/** The harness stopped at a limit of the input, as Claude Code does at `--max-turns`. */
			limit?: SessionLimit;
	  }
	| {
			type: "error";
			kind: Exclude<AgentErrorKind, "aborted">;
			message: string;
			resetAt?: number;
	  };

export type FakeScript = {
	steps?: FakeStep[];
	outcome?: FakeOutcome;
	/** Pause before each event, in ms. Default 5. */
	delayMs?: number;
	model?: string;
};

/** A script, or a function that picks one per call (0-based call index). */
export type FakeScriptSource =
	| FakeScript
	| ((input: AgentSessionInput, call: number) => FakeScript);

export type FakeHarness = AgentHarness & {
	/** The inputs of every `run` call, in order. */
	readonly calls: AgentSessionInput[];
};

export const defaultFakeScript: Required<FakeScript> = {
	steps: [
		{ type: "text", text: "Looking at the repository." },
		{
			type: "tool",
			name: "Read",
			input: { file_path: "README.md" },
			result: "# Example",
		},
		{ type: "text", text: "Done." },
	],
	outcome: {
		type: "finished",
		usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.001 },
	},
	delayMs: 5,
	model: "fake-model",
};

/** A script that ends with a usage limit, after a little text. */
export function usageLimitScript(resetAt?: number): FakeScript {
	return {
		steps: [{ type: "text", text: "Starting." }],
		outcome: {
			type: "error",
			kind: "usage-limit",
			message: "You've hit your limit",
			...(resetAt !== undefined ? { resetAt } : {}),
		},
	};
}

/**
 * A script that reports its step outcome (any outcome name, for a spec's
 * own outcomes), with `data` when given, then finishes.
 */
export function reportingScript(
	outcome: StepReportOutcome,
	summary = `Fake report: ${outcome}`,
	data?: unknown,
): FakeScript {
	return {
		steps: [
			{ type: "text", text: "Working on it." },
			{
				type: "report",
				outcome,
				summary,
				...(data !== undefined ? { data } : {}),
			},
		],
		// A harness reports what it used, as the default script does.
		outcome: defaultFakeScript.outcome,
	};
}

/** A script that ends with a harness failure. */
export function failingScript(message = "Fake harness failure"): FakeScript {
	return {
		steps: [{ type: "text", text: "Starting." }],
		outcome: { type: "error", kind: "harness", message },
	};
}

/** Resolves after `ms`, or as soon as the signal aborts. Never rejects. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const done = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		signal.addEventListener("abort", done, { once: true });
	});
}

function chunksOf(text: string, size: number): string[] {
	const parts: string[] = [];
	for (let i = 0; i < text.length; i += Math.max(1, size)) {
		parts.push(text.slice(i, i + Math.max(1, size)));
	}
	return parts;
}

/**
 * A deterministic in-memory harness for engine tests and development. It
 * emits the scripted events with small pauses, honors the abort signal, and
 * reuses `resumeSessionId` on resume.
 */
export function fakeHarness(script: FakeScriptSource = {}): FakeHarness {
	const calls: AgentSessionInput[] = [];
	let sessions = 0;
	let ids = 0;

	async function* run(input: AgentSessionInput): AsyncGenerator<AgentEvent> {
		const call = calls.length;
		calls.push(input);
		const picked = typeof script === "function" ? script(input, call) : script;
		const { steps, outcome, delayMs, model } = {
			...defaultFakeScript,
			...picked,
		};
		const { signal } = input;

		const sessionId = input.resumeSessionId ?? `fake-session-${++sessions}`;
		yield { type: "session", sessionId, model };

		const bridged = (name: string) =>
			input.tools?.find((tool) => tool.name === name)?.execute;
		/** The answer of a bridged tool, as the bridge hands it to the agent. */
		const answer = async (
			execute: (args: unknown) => unknown,
			args: unknown,
		): Promise<string> => {
			try {
				const out = await execute(args);
				return typeof out === "string" ? out : JSON.stringify(out);
			} catch (error) {
				return `Error: ${error instanceof Error ? error.message : String(error)}`;
			}
		};

		const events = function* (): Generator<
			| AgentEvent
			| { wait: number }
			| {
					call: { toolCallId: string; name: string; input: unknown };
			  }
		> {
			for (const step of steps) {
				if (step.type === "wait") {
					yield { wait: step.ms };
				} else if (step.type === "usage") {
					yield { type: "usage", usage: step.usage };
				} else if (step.type === "report") {
					yield {
						type: "report",
						outcome: step.outcome,
						summary: step.summary,
						...(step.data !== undefined ? { data: step.data } : {}),
					};
				} else if (step.type === "text") {
					const messageId = `fake-message-${++ids}`;
					for (const delta of chunksOf(step.text, step.chunkSize ?? 8)) {
						yield { type: "text", messageId, delta };
					}
				} else {
					const toolCallId = `fake-tool-${++ids}`;
					yield { type: "tool-start", toolCallId, name: step.name };
					yield {
						type: "tool-end",
						toolCallId,
						name: step.name,
						input: step.input ?? {},
					};
					if (bridged(step.name)) {
						yield {
							call: { toolCallId, name: step.name, input: step.input ?? {} },
						};
					} else {
						yield {
							type: "tool-result",
							toolCallId,
							content: step.result ?? "",
						};
					}
				}
			}
		};

		for (const event of events()) {
			await pause("wait" in event ? event.wait : delayMs, signal);
			if (signal.aborted) {
				yield {
					type: "error",
					kind: "aborted",
					message: "The session was aborted",
				};
				return;
			}
			if ("call" in event) {
				const execute = bridged(event.call.name);
				yield {
					type: "tool-result",
					toolCallId: event.call.toolCallId,
					content: execute ? await answer(execute, event.call.input) : "",
				};
			} else if (!("wait" in event)) yield event;
		}

		await pause(delayMs, signal);
		if (signal.aborted) {
			yield {
				type: "error",
				kind: "aborted",
				message: "The session was aborted",
			};
			return;
		}
		yield outcome.type === "finished"
			? {
					type: "finished",
					...(outcome.usage ? { usage: outcome.usage } : {}),
					...(outcome.limit ? { limit: outcome.limit } : {}),
				}
			: {
					type: "error",
					kind: outcome.kind,
					message: outcome.message,
					...(outcome.resetAt !== undefined
						? { resetAt: outcome.resetAt }
						: {}),
				};
	}

	return { name: "claude-code", ...harnessFacts("claude-code"), calls, run };
}

/**
 * One scripted decision: a label (with optional notes and cost), or a whole
 * DecisionResult, for example an error.
 */
export type FakeDecision =
	| { label: string; notes?: string; costUsd?: number | null }
	| DecisionResult;

/** One scripted value: the data (with optional cost), or a whole ValueResult. */
export type FakeValue =
	| { data: unknown; costUsd?: number | null }
	| ValueResult;

export type FakeDecider = Decider & {
	/** The inputs of every `decide` call, in order. */
	readonly calls: DecisionInput[];
	/** The inputs of every `value` call, in order. */
	readonly valueCalls: ValueInput[];
	value(input: ValueInput): Promise<ValueResult>;
};

/**
 * A deterministic decider for engine tests. It returns the scripted results
 * in order, one per call, after `delayMs`. An abort during the pause returns
 * an `aborted` error. Like the real decider, it refuses a scripted label that
 * is not one of the input's labels, and it errors once the script runs out.
 * `options.values` scripts `value` calls the same way (the data is passed on
 * as is: the engine checks it against the schema, as with the real decider).
 */
export function fakeDecider(
	script:
		| FakeDecision[]
		| ((input: DecisionInput, call: number) => FakeDecision),
	options: {
		delayMs?: number;
		values?: FakeValue[] | ((input: ValueInput, call: number) => FakeValue);
	} = {},
): FakeDecider {
	const calls: DecisionInput[] = [];
	const valueCalls: ValueInput[] = [];
	const delayMs = options.delayMs ?? 5;

	async function decide(input: DecisionInput): Promise<DecisionResult> {
		const call = calls.length;
		calls.push(input);
		const aborted: DecisionResult = {
			kind: "error",
			errorKind: "aborted",
			message: "The decision was aborted",
			costUsd: null,
		};
		if (input.signal.aborted) return aborted;
		await pause(delayMs, input.signal);
		if (input.signal.aborted) return aborted;

		const step =
			typeof script === "function" ? script(input, call) : script[call];
		if (step === undefined) {
			return {
				kind: "error",
				errorKind: "harness",
				message: `The fake decider has no scripted result for call ${call + 1}`,
				costUsd: null,
			};
		}
		if ("kind" in step) return step;
		if (!input.labels.some((label) => label.name === step.label)) {
			return {
				kind: "error",
				errorKind: "harness",
				message: `The scripted label "${step.label}" is not one of the labels`,
				costUsd: null,
			};
		}
		return {
			kind: "decided",
			label: step.label,
			notes: step.notes ?? `Fake decision: ${step.label}`,
			costUsd: step.costUsd === undefined ? 0.0001 : step.costUsd,
		};
	}

	async function value(input: ValueInput): Promise<ValueResult> {
		const call = valueCalls.length;
		valueCalls.push(input);
		const aborted: ValueResult = {
			kind: "error",
			errorKind: "aborted",
			message: "The value was aborted",
			costUsd: null,
		};
		if (input.signal.aborted) return aborted;
		await pause(delayMs, input.signal);
		if (input.signal.aborted) return aborted;

		const values = options.values;
		const step =
			values === undefined
				? undefined
				: typeof values === "function"
					? values(input, call)
					: values[call];
		if (step === undefined) {
			return {
				kind: "error",
				errorKind: "harness",
				message: `The fake decider has no scripted value for call ${call + 1}`,
				costUsd: null,
			};
		}
		if ("kind" in step) return step;
		return {
			kind: "made",
			data: step.data,
			costUsd: step.costUsd === undefined ? 0.0001 : step.costUsd,
		};
	}

	return {
		calls,
		valueCalls,
		defaultModel: defaultDeciderModel,
		decide,
		value,
	};
}
