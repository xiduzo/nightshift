import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import {
	DEFAULT_SERVICE_EVERY_SECONDS,
	DEFAULT_SERVICE_TIMEOUT_MINUTES,
	type Flow,
	nodesWithin,
	renderCommand,
	renderTemplate,
	type ServiceNode,
	sectionPath,
	serviceSection,
	type TemplateContext,
} from "@nightshift/flows";

import {
	type HoldSection,
	type ServiceSpec,
	type StepOutputs,
	serviceLogPath,
} from "../../log";
import {
	endedAtReason,
	type NodeAction,
	type NodeKind,
	PLAIN_KIND,
	type StepContext,
} from "../context";
import { RESUME_RULES } from "../resume-point";
import { scopeOf } from "../route";
import { type BodyResult, runStep, type StepHandle } from "../step-runner";

/**
 * The Service node (ADR 9): it starts a process on the step's Device, in
 * the run's worktree, and leaves it running while later steps work. The
 * engine's service keeper (`ctx.services`) starts it and tries its probe
 * until it is ready.
 *
 * - The commands are rendered once, when the step starts, with one set of
 *   environment variables (`renderService`). The log keeps them
 *   (`ServiceStarted.spec`): a resume starts the service again with them,
 *   and a stop after a restart runs the same `stop`.
 * - `ServiceStarted` goes in the log as soon as the process runs, before
 *   the probe: the engine stops the service whatever happens next.
 * - `ready`: the probe said so. `data` is what the ready command wrote to
 *   `$NS_OUTPUT`, `log_tail` the end of the service's log. Later steps
 *   read `log_tail` as the log is when they start
 *   (`withServiceTails`).
 * - `failed`: the service ended or was not ready in time. The keeper
 *   stopped it, and `ServiceStopped` says so.
 * - A stop of the run while it waits for ready stops the service too.
 *
 * Every visit is new (`RESUME_RULES.fresh`): a resume does not assume the
 * old process lives. The engine stops the service when the run leaves its
 * scope (`route.ts`) and on every end of the run (`RunHolds`).
 */
export function serviceStepNode(
	node: ServiceNode,
	ctx: StepContext,
): NodeAction {
	return (state, config) =>
		runStep(ctx, node, state, config, {
			rules: SERVICE.resumeRules(node),
			body: (step) => bringUp(ctx, node, step, config),
		});
}

/** The Service kind: it works in the worktree; `ready` is its chosen end; its probe has its own time. */
export const SERVICE: NodeKind<ServiceNode> = {
	...PLAIN_KIND,
	type: "service",
	make: serviceStepNode,
	works: () => "worktree",
	// A wait node: the step sleeps while its Device is offline.
	aux: () => [{ kind: "wait" }],
	resumeRules: () => RESUME_RULES.fresh,
	isChosenEnd: (_node, outcome) => outcome === "ready",
	endReason: (node, outcome) =>
		outcome === "ready" ? null : endedAtReason(node, outcome),
	timeBudget: () => ({ timeoutMinutes: undefined, idleMinutes: undefined }),
};

/**
 * The node's service as its templates render now. The three commands get
 * one set of environment variables, so a value has one name in all of
 * them.
 */
export function renderService(
	node: ServiceNode,
	tctx: TemplateContext,
): ServiceSpec {
	const { ready } = node;
	const parts = [node.start, ready.command ?? "", node.stop ?? ""];
	const { command, env } = renderCommand(parts.join(SEPARATOR), tctx);
	const [start = "", readyCommand = "", stop = ""] = command.split(SEPARATOR);
	return {
		start,
		ready:
			ready.url !== undefined
				? { url: renderTemplate(ready.url, tctx).trim() }
				: { command: readyCommand },
		everySeconds: ready.everySeconds ?? DEFAULT_SERVICE_EVERY_SECONDS,
		timeoutMinutes: ready.timeoutMinutes ?? DEFAULT_SERVICE_TIMEOUT_MINUTES,
		stop: node.stop !== undefined ? stop : null,
		env,
		...(node.secrets && node.secrets.length > 0
			? { secrets: node.secrets }
			: {}),
	};
}

/** Between the commands while they render as one text: no template spans it. */
const SEPARATOR = "\u0000";

async function bringUp(
	ctx: StepContext,
	node: ServiceNode,
	step: StepHandle,
	config: LangGraphRunnableConfig,
): Promise<BodyResult> {
	const { stepId, visit, signal } = step;
	const runId = ctx.run.id;
	const scope = scopeOf(config);
	const spec = renderService(node, step.tctx);
	if ("url" in spec.ready && spec.ready.url === "") {
		return {
			kind: "end",
			outcome: "error",
			outputs: { visit },
			error: `The ready URL is empty. Check the ready check of "${node.id}".`,
		};
	}
	const section = sectionOf(ctx.flow, node);
	let logged = false;
	step.record(null, {
		type: "service",
		state: "starting",
		command: spec.start,
	});
	const result = await ctx.services.bringUp({
		runId,
		nodeId: node.id,
		scope,
		device: step.device,
		here: step.device.id === ctx.run.walkerId,
		cwd: step.worktree,
		spec,
		logPath: serviceLogPath(ctx.dataDir, runId, stepId),
		signal,
		onStarted: async ({ pid, startedAt }) => {
			await ctx.log.append({
				type: "ServiceStarted",
				runId,
				stepId,
				payload: {
					nodeId: node.id,
					scope,
					...(section ? { section } : {}),
					deviceId: step.device.id,
					cwd: step.worktree,
					logPath: serviceLogPath(ctx.dataDir, runId, stepId),
					pid,
					startedAt,
					spec,
				},
			});
			logged = true;
		},
	});
	const outputs: StepOutputs = { visit, log_tail: result.logTail };
	if (result.kind === "ready") {
		if (result.data !== undefined) outputs.data = result.data;
		step.record(null, { type: "service", state: "ready" });
		return { kind: "end", outcome: "ready", outputs, error: null };
	}
	if (logged) {
		await ctx.log.append({
			type: "ServiceStopped",
			runId,
			stepId,
			payload: {
				nodeId: node.id,
				scope,
				why: result.kind === "failed" ? "failed" : "stopped",
			},
		});
	}
	if (result.kind === "aborted") return { kind: "aborted", outputs };
	step.record(null, {
		type: "service",
		state: "failed",
		reason: result.reason,
	});
	return { kind: "end", outcome: "failed", outputs, error: result.reason };
}

/**
 * The Section the service lives for, with every node in it, as the run's
 * flow has it. Undefined for the whole run, and for a Section the flow no
 * longer has (the validator refuses such a flow).
 */
function sectionOf(flow: Flow, node: ServiceNode): HoldSection | undefined {
	const id = serviceSection(node);
	if (id === null) return undefined;
	const section = sectionPath(flow, id).at(-1);
	return section ? { id, nodes: nodesWithin(flow, section) } : undefined;
}
