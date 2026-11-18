import {
	chatCanUseTools,
	chatTurn,
	checkAgent,
	explainRun,
	installedSkills,
	resumesOnAnotherModel,
	suggestField,
} from "@nightshift/agents";
import { harnessLabel } from "@nightshift/agents/harness-facts";
import type { DecisionResult, ValueResult } from "@nightshift/agents/types";
import { endedEarly } from "@nightshift/engine/run-status";
import {
	AGENT_ENTRIES,
	type AssistantAgent,
	type AssistantService,
	BUILTIN_AGENTS,
	type BuiltinAgentId,
	type BuiltinCheck,
	type BuiltinStatus,
	builtinAgent,
	builtinModel,
	type ChatEvent,
	type ChatRequest,
	canMakeValue,
	chatMessage,
	decisionDecider,
	type ExplanationEvent,
	type ModelPick,
	valueDecider,
} from "@nightshift/flows";
import { now } from "@nightshift/time";
import {
	CHECK_LABELS,
	CHECK_OUTPUT,
	CHECK_QUESTION,
	CHECK_TIMEOUTS,
	CHECK_VALUE_PROMPT,
	modelHint,
	modelProblem,
	NO_CHECK_FOLDER,
	NO_CHECK_MODEL,
	seconds,
	within,
} from "./agent-check";
import type { AssistantDeps } from "./assistant-deps";
import { authoringPort, chatRun, historyPort } from "./authoring";
import {
	chatRefusal,
	chosenAgent,
	harnessOf,
	NO_CHAT_PROFILE,
	NO_CLONE,
	NO_EXPLAIN_PROFILE,
	NO_MODEL_HERE,
	NO_PROFILE,
	pickAgent,
	picksAgent,
	type ReportAgent,
	reportAgentVia,
	sameAgent,
} from "./pick-agent";
import { flowPlace } from "./place";
import { type ChatThread, createThreadStore, keepExchange } from "./threads";

export const NOT_ENDED_EARLY =
	"This run did not stop early, so there is nothing to explain.";

export const NO_RUN = "This run is not in one of your Spaces.";

export const BUSY =
	"The agent still answers your last message. Wait for it, or stop it first.";

/** The daemon's assistant: suggestions and chats on the agent the person picks, read only in the project's Clone. */
export function createAssistant(deps: AssistantDeps): AssistantService {
	const threads = deps.threads ?? createThreadStore();
	const skills = deps.skills ?? installedSkills;

	/**
	 * Where the assistant works for a project: its Clone here, or its own
	 * folder for a project without one (ADR 22). Null: not on this computer.
	 */
	async function workFolder(
		projectId: string,
		spaceId?: string,
	): Promise<string | null> {
		const clone = await deps.clonePath(projectId, spaceId);
		if (clone !== null) return clone;
		if (!deps.ownFolder || !(await deps.withoutFolder?.(projectId))) {
			return null;
		}
		return deps.ownFolder();
	}

	/** The thread a message continues, when it still can. */
	const continued = (request: ChatRequest): ChatThread | null => {
		const thread = request.threadId ? threads.get(request.threadId) : null;
		return thread &&
			thread.projectId === request.projectId &&
			thread.flowName === request.flowName
			? thread
			: null;
	};

	/** What answers for a built-in agent that gives one report. */
	const reportVia = (
		id: ReportAgent,
		requested: AssistantAgent,
		folder: () => Promise<string | null>,
		none: string,
	) => reportAgentVia(deps, id, requested, folder, none);

	/** Who answers for one built-in agent now, or why nothing can. */
	function statusOf(id: BuiltinAgentId): BuiltinStatus {
		const { takes } = builtinAgent(id);
		const answer = deps.settings.current().builtinAgents[id];
		if (answer?.kind === "model" || takes === "model") {
			// With no choice, the Decider runs on what a node without a decider
			// runs on, and the Brief writer on what a Value without one does.
			const chosen = answer?.kind === "model" ? answer : null;
			const pick = chosen
				? builtinModel(chosen, deps.profiles.list(), {
						values: id !== "decider",
					})
				: ({
						decider: id === "decider" ? decisionDecider({}) : valueDecider({}),
					} satisfies ModelPick as ModelPick);
			if ("problem" in pick) {
				return { id, chosen: true, answers: null, problem: pick.problem };
			}
			return {
				id,
				chosen: chosen !== null,
				answers: {
					kind: "model",
					...(chosen?.profile !== undefined ? { profile: chosen.profile } : {}),
					decider: pick.decider,
					...(pick.model !== undefined ? { model: pick.model } : {}),
				},
				problem: null,
			};
		}
		const tools = takes === "agent-with-tools";
		const picked = pickAgent({}, deps, {
			builtin: id,
			...(tools ? { fits: chatCanUseTools } : {}),
			none: tools ? NO_CHAT_PROFILE : NO_PROFILE,
		});
		if ("error" in picked) {
			return { id, chosen: false, answers: null, problem: picked.error };
		}
		const refusal = tools ? chatRefusal(picked) : null;
		const harness = harnessOf(picked, chosenAgent(id, deps), deps);
		return {
			id,
			chosen: answer?.kind === "agent",
			answers: {
				kind: "agent",
				profile: picked.profile,
				harness: picked.settings.harness,
				model: picked.settings.model,
				...(picked.settings.effort !== undefined
					? { effort: picked.settings.effort }
					: {}),
			},
			problem: refusal ?? ("error" in harness ? harness.error : null),
		};
	}

	/**
	 * The model a run asks for the Decider or the Brief writer, or the model
	 * the person chose for the Explainer or the Field writer. With no choice
	 * a Decision asks TypeSafe, and a Gate's brief asks the first decider
	 * that writes (`valueDecider`), as the engine does.
	 */
	function checkedModel(id: BuiltinAgentId):
		| {
				pick: ModelPick;
				answers: Extract<BuiltinStatus["answers"], { kind: "model" }>;
		  }
		| { problem: string } {
		const answer = deps.settings.current().builtinAgents[id];
		const chosen = answer?.kind === "model" ? answer : null;
		const pick: ModelPick | { problem: string } = chosen
			? builtinModel(chosen, deps.profiles.list(), {
					values: id !== "decider",
				})
			: { decider: id === "decider" ? "typesafe" : valueDecider({}) };
		if ("problem" in pick) return pick;
		return {
			pick,
			answers: {
				kind: "model",
				...(chosen?.profile !== undefined ? { profile: chosen.profile } : {}),
				decider: pick.decider,
				...(pick.model !== undefined ? { model: pick.model } : {}),
			},
		};
	}

	/** One small call to the model of `id`. Null: it answered. Else the problem. */
	async function askModel(
		id: BuiltinAgentId,
		pick: ModelPick,
		signal: AbortSignal,
	): Promise<string | null> {
		const to = {
			decider: pick.decider,
			...(pick.model !== undefined ? { model: pick.model } : {}),
			...(pick.address !== undefined ? { address: pick.address } : {}),
			signal,
		};
		// The Decider picks an option, as a Decision in a run asks it. Without
		// that call, a model that also writes is asked for a value.
		const options = id === "decider" ? deps.decideOption : undefined;
		if (!options && (!deps.decide || !canMakeValue(pick.decider))) {
			// The Explainer and the Field writer can run on an agent instead.
			return deps.decide || builtinAgent(id).takes === "model"
				? NO_CHECK_MODEL
				: NO_MODEL_HERE;
		}
		const timeouts = deps.checkTimeouts ?? CHECK_TIMEOUTS;
		let result: DecisionResult | ValueResult | "late";
		try {
			result = await within<DecisionResult | ValueResult>(
				timeouts.modelMs,
				signal,
				(limited) =>
					options
						? options({
								...to,
								prompt: CHECK_QUESTION,
								labels: CHECK_LABELS,
								signal: limited,
							})
						: (deps.decide as NonNullable<AssistantDeps["decide"]>)({
								...to,
								prompt: CHECK_VALUE_PROMPT,
								output: CHECK_OUTPUT,
								signal: limited,
							}),
			);
		} catch (error) {
			return modelProblem(
				pick.decider,
				"harness",
				error instanceof Error ? error.message : "",
			);
		}
		if (result === "late") {
			return `The model did not answer in ${seconds(timeouts.modelMs)} seconds. ${modelHint(pick.decider)}`;
		}
		if (result.kind !== "error") return null;
		return modelProblem(
			pick.decider,
			signal.aborted ? "aborted" : result.errorKind,
			result.message,
		);
	}

	/**
	 * The check of one built-in agent: one small question to what answers
	 * for it. An agent answers in a read-only session in the assistant's own
	 * folder, with no tools. A model answers in one call.
	 */
	async function check(
		id: BuiltinAgentId,
		signal: AbortSignal,
	): Promise<BuiltinCheck> {
		const started = now();
		const done = (
			answers: BuiltinCheck["answers"],
			problem: string | null,
		): BuiltinCheck => ({
			id,
			ok: problem === null,
			ms: now() - started,
			answers,
			problem,
		});
		try {
			const status = statusOf(id);
			if (builtinAgent(id).takes === "model" || status.answers === null) {
				// A model, or nothing: the status says why nothing can answer.
				if (status.problem !== null) return done(null, status.problem);
				const model = checkedModel(id);
				if ("problem" in model) return done(null, model.problem);
				return done(model.answers, await askModel(id, model.pick, signal));
			}
			if (status.answers.kind === "model") {
				const model = checkedModel(id);
				if ("problem" in model) return done(null, model.problem);
				return done(model.answers, await askModel(id, model.pick, signal));
			}
			const { answers } = status;
			// The status holds the refusal of an agent without Night Shift's
			// tools (the Builder, the Improver) and a harness that is not added.
			if (status.problem !== null) return done(answers, status.problem);
			const label = harnessLabel(answers.harness);
			const harness = deps.harnessFor(answers.harness);
			if (!harness || !deps.installed(answers.harness)) {
				return done(
					answers,
					`Night Shift cannot find ${label} on this computer. Install it, or choose another agent in Settings.`,
				);
			}
			// The same agent as the status names, with its settings as a session takes them.
			const picked = pickAgent({}, deps, {
				builtin: id,
				...(builtinAgent(id).takes === "agent-with-tools"
					? { fits: chatCanUseTools }
					: {}),
			});
			if ("error" in picked) return done(answers, picked.error);
			const cwd = await deps.ownFolder?.();
			if (cwd === undefined) return done(answers, NO_CHECK_FOLDER);
			const timeouts = deps.checkTimeouts ?? CHECK_TIMEOUTS;
			const result = await within(timeouts.agentMs, signal, (limited) =>
				checkAgent({
					harness,
					profile: picked.settings,
					cwd,
					signal: limited,
				}),
			);
			if (result === "late") {
				return done(
					answers,
					`${label} did not answer in ${seconds(timeouts.agentMs)} seconds. Check that you are signed in to it, then try again.`,
				);
			}
			if (result.answered) return done(answers, null);
			return done(
				answers,
				signal.aborted ? "Stopped." : `${label} did not answer. ${result.why}`,
			);
		} catch (error) {
			const said = error instanceof Error ? error.message.trim() : "";
			return done(
				null,
				`The check did not finish. ${said ? `${said} ` : ""}Try again.`,
			);
		}
	}

	return {
		agents: () => BUILTIN_AGENTS.map((agent) => statusOf(agent.id)),
		check,

		async *suggest(request, signal, scope) {
			const via = await reportVia(
				"field-writer",
				request,
				() => workFolder(request.projectId),
				NO_PROFILE,
			);
			if ("error" in via) {
				yield { type: "error", message: via.error };
				return;
			}
			// The answer is checked in the draft's place, as the editor checks it.
			const place = await flowPlace(
				{
					space: deps.space(scope),
					cliTools: deps.cliTools,
					connections: deps.connections,
					withoutFolder: deps.withoutFolder,
				},
				request.projectId,
				request.flowName,
			);
			yield* suggestField({ request, via, place, signal });
		},

		async *chat(request, signal, scope): AsyncGenerator<ChatEvent> {
			const existing = continued(request);
			if (existing?.busy) {
				yield { type: "error", message: BUSY };
				return;
			}
			// The entry names the agent. A chat about a run is the Improver's,
			// and a chat that became the Improver's stays so.
			const entered = request.entry
				? AGENT_ENTRIES[request.entry].agent
				: request.runId
					? "improver"
					: "builder";
			const builtin: "builder" | "improver" =
				existing?.builtin === "improver" || entered === "improver"
					? "improver"
					: "builder";
			// A later message that picks no agent stays on the thread's, unless
			// the thread goes to the other built-in agent.
			const stays =
				existing && existing.builtin === builtin && !picksAgent(request);
			const requested: AssistantAgent = stays ? existing.agent : request;
			const picked = pickAgent(requested, deps, {
				fits: chatCanUseTools,
				none: NO_CHAT_PROFILE,
				builtin,
			});
			if ("error" in picked) {
				yield { type: "error", message: picked.error };
				return;
			}
			const refusal = chatRefusal(picked);
			if (refusal) {
				yield { type: "error", message: refusal };
				return;
			}
			const harness = harnessOf(
				picked,
				picksAgent(requested) ? requested : chosenAgent(builtin, deps),
				deps,
			);
			if ("error" in harness) {
				yield { type: "error", message: harness.error };
				return;
			}
			const cwd = await workFolder(request.projectId, scope.spaceId);
			if (cwd === null) {
				yield { type: "error", message: NO_CLONE };
				return;
			}
			const thread =
				existing ??
				threads.start({
					projectId: request.projectId,
					flowName: request.flowName,
					agent: picked.settings,
					builtin,
				});
			thread.builtin = builtin;
			// Another agent: its session resumes only on the same harness,
			// when that harness takes another model on resume. Else a new
			// session gets the conversation so far.
			if (!sameAgent(thread.agent, picked.settings)) {
				const resumable =
					thread.agent.harness === picked.settings.harness &&
					resumesOnAnotherModel(picked.settings.harness);
				if (!resumable) thread.sessionId = null;
				thread.agent = picked.settings;
			}
			const resume = thread.sessionId;
			const newRun =
				request.runId !== undefined && !thread.runIds.has(request.runId);
			thread.busy = true;
			let answer = "";
			try {
				yield { type: "thread", threadId: thread.id };
				const space = deps.space(scope);
				const port = authoringPort(
					{
						space,
						profiles: deps.profiles,
						cliTools: deps.cliTools,
						connections: deps.connections,
						skills: () => skills(picked.settings.harness, { projectPath: cwd }),
						withoutFolder: deps.withoutFolder,
					},
					request,
					signal,
				);
				for await (const event of chatTurn({
					request,
					agent: builtin,
					harness,
					profile: picked.settings,
					cwd,
					port,
					past: historyPort(space, request, signal),
					...(resume
						? { resumeSessionId: resume, newRun }
						: { history: thread.exchanges }),
					signal,
				})) {
					if (event.type === "session") {
						thread.sessionId = event.sessionId;
						continue;
					}
					if (event.type === "text") answer += event.delta;
					yield event;
				}
				if (request.runId) thread.runIds.add(request.runId);
			} finally {
				keepExchange(thread, {
					message: chatMessage(request) ?? "",
					answer,
				});
				thread.busy = false;
			}
		},

		async *explain(request, signal, scope): AsyncGenerator<ExplanationEvent> {
			const space = deps.space(scope);
			const detail = await space.getRun(request.runId).catch(() => null);
			if (!detail) {
				yield { type: "error", message: NO_RUN };
				return;
			}
			if (!endedEarly(detail.status)) {
				yield { type: "error", message: NOT_ENDED_EARLY };
				return;
			}
			// An agent that works here, or a model: the explanation needs no tools.
			const via = await reportVia(
				"explainer",
				request,
				async () =>
					(await deps.clonePath(detail.projectId, scope.spaceId)) ??
					(await deps.ownFolder?.()) ??
					null,
				NO_EXPLAIN_PROFILE,
			);
			if ("error" in via) {
				yield { type: "error", message: via.error };
				return;
			}
			yield { type: "activity", text: "Reads the run" };
			const run = await chatRun(space, detail, signal);
			yield* explainRun({ run, via, signal });
		},
	};
}
