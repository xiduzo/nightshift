/**
 * SPIKE. Compiles a Night Shift flow (the JSON the editor writes) into a
 * LangGraph StateGraph.
 *
 * Every flow node becomes one graph node. A node runs its step, picks the
 * edge to take with the flow's own `nextEdge`, and returns a Command that
 * updates the run state and jumps to the next node. The graph checkpoints
 * the state after every node, so a run can continue from any node after a
 * crash, and LangGraph's `interrupt` carries the two ways a run parks:
 * a usage-limit or network wait, and a Gate waiting for a person.
 *
 * An Agent node that hits a usage limit hands over to its wait node
 * (`wait__<id>`), which interrupts; resuming re-enters the Agent node with
 * `pending` set, so it continues the same harness session.
 */
import {
	Command,
	END,
	interrupt,
	type LangGraphRunnableConfig,
	START,
	StateGraph,
} from "@langchain/langgraph";
import { withLangGraph } from "@langchain/langgraph/zod";
import type {
	AgentEvent,
	AgentHarness,
	Decider,
	HarnessName,
} from "@nightshift/agents";
import {
	type AgentNode,
	type CommandNode,
	type DecisionNode,
	type Flow,
	type FlowNode,
	type ForEachNode,
	type GateNode,
	type JsonValue,
	type ListItem,
	nextEdge,
	normalizeList,
	renderTemplate,
	renderValue,
	resolvedAgent,
	type SubflowNode,
	type TemplateContext,
} from "@nightshift/flows";
import { z } from "zod";

export const DEFAULT_RESUME_PROMPT = "Continue where you left off.";

/** A record channel whose updates merge in, key by key (like node outputs by id). */
function mergedRecord<V>() {
	const schema = z.record(z.string(), z.any());
	return withLangGraph(schema, {
		reducer: {
			schema,
			fn: (a: Record<string, V>, b: Record<string, V>) => ({ ...a, ...b }),
		},
		default: () => ({}) as Record<string, V>,
	});
}

const stepSchema = z.object({
	nodeId: z.string(),
	visit: z.number(),
	outcome: z.string(),
	at: z.number(),
	error: z.string().nullable(),
});
export type Step = z.infer<typeof stepSchema>;

const pendingSchema = z.object({
	nodeId: z.string(),
	harnessSessionId: z.string().nullable(),
	prompt: z.string(),
	reason: z.enum(["usage-limit", "network"]),
	message: z.string(),
	resetAt: z.number().nullable(),
});
export type Pending = z.infer<typeof pendingSchema>;

const endedSchema = z.object({
	status: z.enum(["finished", "failed"]),
	nodeId: z.string(),
	outcome: z.string(),
	reason: z.string().nullable(),
});
export type Ended = z.infer<typeof endedSchema>;

/** The run state LangGraph checkpoints after every node. */
export const RunState = z.object({
	inputs: withLangGraph(z.record(z.string(), z.any()), {
		default: () => ({}) as Record<string, JsonValue>,
	}),
	/** Node outputs by node id, latest visit. */
	nodes: mergedRecord<Record<string, JsonValue>>(),
	visits: mergedRecord<number>(),
	traversals: mergedRecord<number>(),
	steps: withLangGraph(z.array(stepSchema), {
		reducer: {
			schema: z.array(stepSchema),
			fn: (a: Step[], b: Step[]) => [...a, ...b],
		},
		default: () => [] as Step[],
	}),
	/** For Each progress by node id. */
	loops: mergedRecord<Loop | null>(),
	/** The Agent step a wait parked, to continue when the run resumes. */
	pending: withLangGraph(pendingSchema.nullable(), {
		default: () => null as Pending | null,
	}),
	ended: withLangGraph(endedSchema.nullable(), {
		default: () => null as Ended | null,
	}),
});
export type RunStateValues = z.infer<typeof RunState>;

type Loop = {
	items: ListItem[];
	index: number;
	results: { id: string; title: string; ended: string }[];
};

/** What a step streams while it runs (LangGraph's `custom` stream mode). */
export type RunEvent =
	| { type: "step-started"; nodeId: string; visit: number }
	| { type: "agent"; nodeId: string; visit: number; event: AgentEvent }
	| { type: "step-ended"; nodeId: string; visit: number; outcome: string };

/** What an interrupt carries: a wait, or a Gate. */
export type Parked =
	| {
			kind: "wait";
			nodeId: string;
			reason: "usage-limit" | "network";
			message: string;
			resetAt: number | null;
	  }
	| { kind: "gate"; nodeId: string; question: string; choices: string[] };

export type Services = {
	harnesses: Partial<Record<HarnessName, AgentHarness>>;
	decider?: Decider;
	/** The project's flows by name, for Subflow and For Each. */
	flows: Record<string, Flow>;
	/** The run's worktree. */
	cwd: string;
	run: TemplateContext["run"];
	now?: () => number;
};

const waitNode = (id: string) => `wait__${id}`;

export function compileFlow(flow: Flow, services: Services) {
	const now = services.now ?? Date.now;
	const nodeIds = flow.nodes.map((n) => n.id);
	const ends = [...nodeIds, END];

	const context = (state: RunStateValues): TemplateContext => ({
		nodes: state.nodes,
		inputs: state.inputs,
		run: services.run,
	});

	/**
	 * Records the step and jumps along the edge the outcome picks, or ends
	 * the run: like the engine's walk, `fail` and `needs-input` without an
	 * edge fail the run; `pass`, a label, a choice or an own outcome without
	 * an edge is a chosen end.
	 */
	function route(
		state: RunStateValues,
		node: FlowNode,
		input: {
			outcome: string;
			outputs: Record<string, JsonValue>;
			visit: number;
			error?: string | null;
			update?: Partial<RunStateValues>;
		},
	): Command {
		const { outcome, visit } = input;
		const update: Partial<RunStateValues> = {
			...input.update,
			nodes: { [node.id]: { ...input.outputs, outcome, visit } },
			visits: { [node.id]: visit },
			steps: [
				{
					nodeId: node.id,
					visit,
					outcome,
					at: now(),
					error: input.error ?? null,
				},
			],
			pending: null,
		};
		const fail = (reason: string) =>
			new Command({
				update: {
					...update,
					ended: { status: "failed", nodeId: node.id, outcome, reason },
				},
				goto: END,
			});
		if (outcome === "error") return fail(input.error ?? "The step failed.");
		const choice = nextEdge({
			flow,
			from: node.id,
			outcome,
			traversals: state.traversals,
		});
		if (choice.kind === "end") {
			if (outcome === "fail" || outcome === "needs-input") {
				return fail(
					`Node "${node.id}" ended with "${outcome}" and no edge leaves it on that outcome.`,
				);
			}
			return new Command({
				update: {
					...update,
					ended: { status: "finished", nodeId: node.id, outcome, reason: null },
				},
				goto: END,
			});
		}
		if (choice.kind === "exhausted") {
			return fail(
				`Node "${node.id}" ended with "${outcome}", but edge ${choice.edges.map((e) => `"${e.id}"`).join(", ")} reached its max.`,
			);
		}
		const { edge } = choice;
		return new Command({
			update: {
				...update,
				traversals: { [edge.id]: (state.traversals[edge.id] ?? 0) + 1 },
			},
			goto: edge.to,
		});
	}

	const emit = (config: LangGraphRunnableConfig, event: RunEvent) =>
		config.writer?.(event);

	function agentStep(node: AgentNode) {
		return async (state: RunStateValues, config: LangGraphRunnableConfig) => {
			const pending = state.pending?.nodeId === node.id ? state.pending : null;
			const visit = pending
				? (state.visits[node.id] ?? 1)
				: (state.visits[node.id] ?? 0) + 1;
			emit(config, { type: "step-started", nodeId: node.id, visit });

			const agent = resolvedAgent(node);
			if (!agent) {
				return route(state, node, {
					outcome: "error",
					outputs: {},
					visit,
					error: `Agent node "${node.id}" has no harness, model or permission mode.`,
				});
			}
			const harness = services.harnesses[agent.harness];
			if (!harness) {
				return route(state, node, {
					outcome: "error",
					outputs: {},
					visit,
					error: `No ${agent.harness} harness is added.`,
				});
			}
			const rendered = renderTemplate(node.prompt, context(state));
			const prompt = pending
				? pending.prompt
				: node.skill
					? `/${node.skill} ${rendered}`.trim()
					: rendered;
			const resumeSessionId =
				pending?.harnessSessionId ??
				(node.session === "resume"
					? (state.nodes[node.id]?.session_id as string | undefined) ||
						undefined
					: undefined);

			let harnessSessionId: string | null = resumeSessionId ?? null;
			let report: { outcome: string; summary: string; data?: unknown } | null =
				null;
			let output = "";
			let afterTool = false;
			let lastMessageId: string | null = null;
			let ending:
				| { kind: "finished"; costUsd: number | null }
				| {
						kind: "error";
						errorKind: string;
						message: string;
						resetAt: number | null;
				  }
				| null = null;

			for await (const event of harness.run({
				cwd: services.cwd,
				prompt,
				model: agent.model,
				permissionMode: agent.permissionMode,
				effort: agent.effort,
				resumeSessionId,
				stepReport:
					node.outcomes || node.output
						? { outcomes: node.outcomes, output: node.output }
						: true,
				tools: node.tools ?? [],
				signal: config.signal ?? new AbortController().signal,
			})) {
				emit(config, { type: "agent", nodeId: node.id, visit, event });
				switch (event.type) {
					case "session":
						harnessSessionId = event.sessionId;
						break;
					case "text":
						if (afterTool || event.messageId !== lastMessageId) {
							output = "";
							afterTool = false;
							lastMessageId = event.messageId;
						}
						output += event.delta;
						break;
					case "tool-start":
					case "tool-end":
					case "tool-result":
						afterTool = true;
						break;
					case "report":
						afterTool = true;
						report = {
							outcome: event.outcome,
							summary: event.summary,
							data: event.data,
						};
						break;
					case "finished":
						ending = {
							kind: "finished",
							costUsd: event.usage?.costUsd ?? null,
						};
						break;
					case "error":
						ending = {
							kind: "error",
							errorKind: event.kind,
							message: event.message,
							resetAt: event.resetAt ?? null,
						};
						break;
				}
				if (ending) break;
			}

			const outputs: Record<string, JsonValue> = {
				output,
				summary: report?.summary || output,
				session_id: harnessSessionId ?? "",
				...(report?.data !== undefined
					? { data: report.data as JsonValue }
					: {}),
			};

			if (
				ending?.kind === "error" &&
				(ending.errorKind === "usage-limit" || ending.errorKind === "network")
			) {
				// Park: the wait node interrupts; a resume re-enters this node.
				return new Command({
					update: {
						pending: {
							nodeId: node.id,
							harnessSessionId,
							prompt: DEFAULT_RESUME_PROMPT,
							reason: ending.errorKind,
							message: ending.message,
							resetAt: ending.resetAt,
						},
						visits: { [node.id]: visit },
					},
					goto: waitNode(node.id),
				});
			}

			const done = (outcome: string, error: string | null = null) => {
				emit(config, { type: "step-ended", nodeId: node.id, visit, outcome });
				return route(state, node, { outcome, outputs, visit, error });
			};
			if (ending?.kind === "error") return done("error", ending.message);
			if (report) {
				const outcomes = node.outcomes?.map((o) => o.name) ?? [
					"pass",
					"fail",
					"needs-input",
				];
				if (!outcomes.includes(report.outcome)) {
					return done(
						"error",
						`The agent reported "${report.outcome}", which is not an outcome of this node.`,
					);
				}
				return done(report.outcome);
			}
			if (node.outcomes || node.output) {
				return done("error", "The agent finished with no step report.");
			}
			return done("pass");
		};
	}

	/** Interrupts until the run resumes, then re-enters the Agent node. */
	function waitStep(node: AgentNode) {
		return async (state: RunStateValues) => {
			const pending = state.pending;
			if (!pending || pending.nodeId !== node.id) {
				throw new Error(`Nothing is pending for node "${node.id}".`);
			}
			const answer = interrupt<Parked, { prompt?: string } | undefined>({
				kind: "wait",
				nodeId: node.id,
				reason: pending.reason,
				message: pending.message,
				resetAt: pending.resetAt,
			});
			return new Command({
				update: {
					pending: { ...pending, prompt: answer?.prompt ?? pending.prompt },
				},
				goto: node.id,
			});
		};
	}

	function commandStep(node: CommandNode) {
		return async (state: RunStateValues, config: LangGraphRunnableConfig) => {
			const visit = (state.visits[node.id] ?? 0) + 1;
			emit(config, { type: "step-started", nodeId: node.id, visit });
			const proc = Bun.spawn(
				["sh", "-c", renderTemplate(node.command, context(state))],
				{
					cwd: services.cwd,
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const [stdout, stderr, code] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			const outcome = code === 0 ? "pass" : "fail";
			emit(config, { type: "step-ended", nodeId: node.id, visit, outcome });
			return route(state, node, {
				outcome,
				outputs: {
					output: stdout.trimEnd(),
					stderr: stderr.trimEnd(),
					exit_code: code,
				},
				visit,
			});
		};
	}

	function decisionStep(node: DecisionNode) {
		return async (state: RunStateValues, config: LangGraphRunnableConfig) => {
			const visit = (state.visits[node.id] ?? 0) + 1;
			emit(config, { type: "step-started", nodeId: node.id, visit });
			if (!services.decider) {
				return route(state, node, {
					outcome: "error",
					outputs: {},
					visit,
					error: "No decider.",
				});
			}
			const result = await services.decider.decide({
				cwd: services.cwd,
				prompt: renderTemplate(node.prompt, context(state)),
				labels: node.labels,
				model: node.model,
				tools: node.tools,
				signal: config.signal ?? new AbortController().signal,
			});
			if (result.kind === "error") {
				return route(state, node, {
					outcome: "error",
					outputs: {},
					visit,
					error: result.message,
				});
			}
			emit(config, {
				type: "step-ended",
				nodeId: node.id,
				visit,
				outcome: result.label,
			});
			return route(state, node, {
				outcome: result.label,
				outputs: { label: result.label, notes: result.notes },
				visit,
			});
		};
	}

	/** Interrupts with the question; the resume value is the choice. */
	function gateStep(node: GateNode) {
		return async (state: RunStateValues, config: LangGraphRunnableConfig) => {
			const visit = (state.visits[node.id] ?? 0) + 1;
			const choices = node.choices.map((c) => c.name);
			const question = renderTemplate(node.question, context(state));
			const answer = interrupt<Parked, string>({
				kind: "gate",
				nodeId: node.id,
				question,
				choices,
			});
			if (!choices.includes(answer)) {
				return route(state, node, {
					outcome: "error",
					outputs: {},
					visit,
					error: `"${answer}" is not a choice of gate "${node.id}".`,
				});
			}
			emit(config, {
				type: "step-ended",
				nodeId: node.id,
				visit,
				outcome: answer,
			});
			return route(state, node, {
				outcome: answer,
				outputs: { choice: answer },
				visit,
			});
		};
	}

	/** Runs the called flow as a subgraph, under this node's checkpoint namespace. */
	async function callFlow(
		name: string,
		inputs: Record<string, JsonValue>,
		config: LangGraphRunnableConfig,
	): Promise<RunStateValues> {
		const called = services.flows[name];
		if (!called) throw new Error(`The project has no flow "${name}".`);
		const graph = compileFlow(called, services).compile();
		return (await graph.invoke({ inputs }, config)) as RunStateValues;
	}

	function bindInputs(
		bindings: Record<string, string>,
		state: RunStateValues,
	): Record<string, JsonValue> {
		return Object.fromEntries(
			Object.entries(bindings).map(([k, v]) => [
				k,
				renderValue(v, context(state)),
			]),
		);
	}

	function calledOutputs(
		name: string,
		result: RunStateValues,
	): Record<string, JsonValue> {
		const called = services.flows[name];
		const ctx: TemplateContext = {
			nodes: result.nodes,
			inputs: result.inputs,
			run: services.run,
		};
		const outputs: Record<string, JsonValue> = {};
		for (const out of called?.outputs ?? [])
			outputs[out.name] = renderValue(out.value, ctx);
		const chosen =
			result.ended?.status === "finished" && result.ended.outcome !== "pass";
		outputs.ended = chosen ? (result.ended?.outcome ?? "") : "";
		return outputs;
	}

	function subflowStep(node: SubflowNode) {
		return async (state: RunStateValues, config: LangGraphRunnableConfig) => {
			const visit = (state.visits[node.id] ?? 0) + 1;
			emit(config, { type: "step-started", nodeId: node.id, visit });
			const result = await callFlow(
				node.flow,
				bindInputs(node.inputs, state),
				config,
			);
			const outcome = result.ended?.status === "finished" ? "pass" : "fail";
			emit(config, { type: "step-ended", nodeId: node.id, visit, outcome });
			return route(state, node, {
				outcome,
				outputs: calledOutputs(node.flow, result),
				visit,
				error: result.ended?.reason ?? null,
			});
		};
	}

	/**
	 * One element per super-step: the node runs the body for the element at
	 * the cursor and jumps back to itself. An interrupt inside the body
	 * resumes inside that element, because the body is a subgraph under this
	 * node's task.
	 */
	function forEachStep(node: ForEachNode) {
		return async (state: RunStateValues, config: LangGraphRunnableConfig) => {
			let loop = state.loops[node.id] ?? null;
			const visit = loop
				? (state.visits[node.id] ?? 1)
				: (state.visits[node.id] ?? 0) + 1;
			if (!loop) {
				emit(config, { type: "step-started", nodeId: node.id, visit });
				if (node.source.kind !== "json") {
					return route(state, node, {
						outcome: "error",
						outputs: {},
						visit,
						error: `SPIKE: only the json source is compiled (got ${node.source.kind}).`,
					});
				}
				// One reference keeps its value; any other text is JSON once rendered.
				const rendered = renderValue(node.source.value, context(state));
				const list = normalizeList(
					typeof rendered === "string"
						? (JSON.parse(rendered) as JsonValue)
						: rendered,
				);
				if (!list.ok) {
					return route(state, node, {
						outcome: "error",
						outputs: {},
						visit,
						error: list.error,
					});
				}
				loop = { items: list.items, index: 0, results: [] };
			}
			const item = loop.items[loop.index];
			if (!item) {
				emit(config, {
					type: "step-ended",
					nodeId: node.id,
					visit,
					outcome: "done",
				});
				return route(state, node, {
					outcome: "done",
					outputs: {
						items: loop.results as unknown as JsonValue,
						count: loop.results.length,
					},
					visit,
					update: { loops: { [node.id]: null } },
				});
			}
			const result = await callFlow(
				node.flow,
				{ ...bindInputs(node.inputs, state), [node.as]: item.value },
				config,
			);
			const ended = calledOutputs(node.flow, result).ended as string;
			const results = [
				...loop.results,
				{ id: item.id, title: item.title, ended },
			];
			if (result.ended?.status !== "finished") {
				return route(state, node, {
					outcome: "error",
					outputs: { items: results as unknown as JsonValue },
					visit,
					error: `Element "${item.title}" failed: ${result.ended?.reason ?? "unknown"}`,
					update: { loops: { [node.id]: null } },
				});
			}
			if (node.haltOn.includes(ended)) {
				emit(config, {
					type: "step-ended",
					nodeId: node.id,
					visit,
					outcome: "halted",
				});
				return route(state, node, {
					outcome: "halted",
					outputs: {
						items: results as unknown as JsonValue,
						count: results.length,
					},
					visit,
					update: { loops: { [node.id]: null } },
				});
			}
			return new Command({
				update: {
					loops: { [node.id]: { ...loop, index: loop.index + 1, results } },
					visits: { [node.id]: visit },
				},
				goto: node.id,
			});
		};
	}

	const graph = new StateGraph(RunState);
	for (const node of flow.nodes) {
		switch (node.type) {
			case "agent":
				graph.addNode(node.id, agentStep(node), {
					ends: [...ends, waitNode(node.id)],
				});
				graph.addNode(waitNode(node.id), waitStep(node), { ends: [node.id] });
				break;
			case "command":
				graph.addNode(node.id, commandStep(node), { ends });
				break;
			case "decision":
				graph.addNode(node.id, decisionStep(node), { ends });
				break;
			case "gate":
				graph.addNode(node.id, gateStep(node), { ends });
				break;
			case "subflow":
				graph.addNode(node.id, subflowStep(node), { ends });
				break;
			case "foreach":
				graph.addNode(node.id, forEachStep(node), { ends: [...ends, node.id] });
				break;
		}
	}
	graph.addEdge(START, flow.start as typeof START);
	return graph;
}
