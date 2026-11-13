/**
 * The check of Night Shift's agents ("Try it") as the screen shows it:
 * which agents one question covers, what a result says, and the fix a
 * failed one offers. Pure: the statuses come from `assistant.agents` and
 * the results from `assistant.check`.
 */
import {
	type BuiltinAgentId,
	type BuiltinCheck,
	type BuiltinStatus,
	builtinAgent,
} from "@nightshift/flows";

/** What answers, or what was asked. */
type Answers = BuiltinCheck["answers"];

/** The models that decide, as the product names them. */
const MODEL_NAMES: Record<string, string> = {
	typesafe: "TypeSafe Jev",
	ollama: "Ollama",
	openrouter: "OpenRouter",
	openai: "OpenAI",
	compatible: "Your model server",
};

/**
 * What answered, in one line: a profile or an agent with its model, or a
 * model. `agentName` names an agent, as the pickers do. Null: nothing answers.
 */
export function answeredBy(
	answers: Answers,
	agentName: (
		harness: Extract<NonNullable<Answers>, { kind: "agent" }>["harness"],
	) => string,
): string | null {
	if (!answers) return null;
	if (answers.kind === "agent") {
		return `${answers.profile ?? agentName(answers.harness)} · ${answers.model}`;
	}
	const name =
		answers.profile ?? MODEL_NAMES[answers.decider] ?? answers.decider;
	return `${name} · ${answers.model ?? "default model"}`;
}

/** How fast it answered: "Answered in 6 s". */
export function answeredIn(ms: number): string {
	if (ms < 1_000) return "Answered in under 1 s";
	return `Answered in ${Math.round(ms / 1_000)} s`;
}

/** The names of some agents as a sentence reads them: "Builder and Improver". */
export function agentNames(ids: readonly BuiltinAgentId[]): string {
	const names = ids.map((id) => builtinAgent(id).name);
	if (names.length <= 1) return names[0] ?? "";
	return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** One question of the check, and the agents it covers. */
export type CheckRow = {
	/** The agents the same agent or model answers for. */
	ids: BuiltinAgentId[];
	/** The agent the question goes to. */
	ask: BuiltinAgentId;
	/** What answers now, as the status says. */
	answers: Answers;
	/** Nothing can answer: the result is known without a question. */
	blocked: BuiltinCheck | null;
};

/** What makes two agents share a question: the same agent or model answers both. */
function sharedKey(status: BuiltinStatus): string | null {
	const { answers } = status;
	if (status.problem !== null || !answers) return null;
	// A run asks the model of the Decider and of the Brief writer in its own
	// way each. Each gets its own question.
	if (builtinAgent(status.id).takes === "model") return null;
	return answers.kind === "agent"
		? ["agent", answers.profile, answers.harness, answers.model, answers.effort]
				.map(String)
				.join("|")
		: ["model", answers.profile, answers.decider, answers.model]
				.map(String)
				.join("|");
}

/**
 * The questions of a check, in the order of the agents. Agents that the
 * same agent or model answers for share one question. An agent that
 * nothing can answer for gets none: its row holds the problem.
 */
export function checkRows(statuses: readonly BuiltinStatus[]): CheckRow[] {
	const rows: CheckRow[] = [];
	const shared = new Map<string, CheckRow>();
	for (const status of statuses) {
		const key = sharedKey(status);
		const same = key === null ? undefined : shared.get(key);
		if (same) {
			same.ids.push(status.id);
			continue;
		}
		const row: CheckRow = {
			ids: [status.id],
			ask: status.id,
			answers: status.answers,
			blocked:
				status.problem === null
					? null
					: {
							id: status.id,
							ok: false,
							ms: 0,
							answers: status.answers,
							problem: status.problem,
						},
		};
		rows.push(row);
		if (key !== null) shared.set(key, row);
	}
	return rows;
}

/**
 * The fix a failed check offers. `agent`: the setup of an agent (install
 * it, sign in). `model`: the setup of a model that decides (download the
 * model, add a key). `settings`: the agent's page in Settings, where the
 * person chooses what answers for it.
 */
export type CheckFix =
	| { kind: "agent" }
	| { kind: "model" }
	| { kind: "settings"; agent: BuiltinAgentId };

/** The models the setup can make ready: it downloads one, or saves the key of the other. */
const SETUP_MODELS: readonly string[] = ["ollama", "typesafe"];

/** The fix for a result, or null when it answered. */
export function checkFix(
	result: Pick<BuiltinCheck, "id" | "ok" | "answers">,
): CheckFix | null {
	if (result.ok) return null;
	const { answers } = result;
	if (answers?.kind === "agent") return { kind: "agent" };
	if (
		answers?.kind === "model" &&
		answers.profile === undefined &&
		SETUP_MODELS.includes(answers.decider)
	) {
		return { kind: "model" };
	}
	// Nothing answers for an agent that needs Night Shift's tools: connect one.
	if (!answers && builtinAgent(result.id).takes === "agent-with-tools") {
		return { kind: "agent" };
	}
	return { kind: "settings", agent: result.id };
}

/** How a check went as a whole. */
export type CheckSummary = {
	/** Every question has its result. */
	checked: boolean;
	/** The results that are a problem. */
	failed: number;
	total: number;
};

/** The results so far, one for each row. Null: not asked yet. */
export function checkSummary(
	results: readonly (Pick<BuiltinCheck, "ok"> | null)[],
): CheckSummary {
	return {
		checked: results.length > 0 && results.every((result) => result !== null),
		failed: results.filter((result) => result?.ok === false).length,
		total: results.length,
	};
}

/** Every agent answered. */
export function allAnswer(summary: CheckSummary): boolean {
	return summary.checked && summary.failed === 0;
}
