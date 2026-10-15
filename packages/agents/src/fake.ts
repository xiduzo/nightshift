import type {
	AgentErrorKind,
	AgentEvent,
	AgentHarness,
	AgentSessionInput,
	AgentUsage,
	StepReportOutcome,
} from "./types";

/** One step of a scripted fake session. */
export type FakeStep =
	| {
			type: "text";
			text: string /** Characters per delta. Default 8. */;
			chunkSize?: number;
	  }
	| { type: "tool"; name: string; input?: unknown; result?: string }
	/** The agent's step report: one `report` event. */
	| { type: "report"; outcome: StepReportOutcome; summary: string }
	| { type: "wait"; ms: number };

export type FakeOutcome =
	| { type: "finished"; usage?: AgentUsage }
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

/** A script that reports its step outcome, then finishes. */
export function reportingScript(
	outcome: StepReportOutcome,
	summary = `Fake report: ${outcome}`,
): FakeScript {
	return {
		steps: [
			{ type: "text", text: "Working on it." },
			{ type: "report", outcome, summary },
		],
		outcome: { type: "finished" },
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

		const events = function* (): Generator<AgentEvent | { wait: number }> {
			for (const step of steps) {
				if (step.type === "wait") {
					yield { wait: step.ms };
				} else if (step.type === "report") {
					yield {
						type: "report",
						outcome: step.outcome,
						summary: step.summary,
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
					yield { type: "tool-result", toolCallId, content: step.result ?? "" };
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
			if (!("wait" in event)) yield event;
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
			? { type: "finished", ...(outcome.usage ? { usage: outcome.usage } : {}) }
			: {
					type: "error",
					kind: outcome.kind,
					message: outcome.message,
					...(outcome.resetAt !== undefined
						? { resetAt: outcome.resetAt }
						: {}),
				};
	}

	return { name: "claude-code", calls, run };
}
