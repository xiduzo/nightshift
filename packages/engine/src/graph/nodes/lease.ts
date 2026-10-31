import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import {
	DEFAULT_LEASE_TTL_MINUTES,
	type LeaseNode,
	renderTemplate,
} from "@nightshift/flows";

import type { LeaseAnswer } from "../../contract";
import type { StepOutputs } from "../../log";
import {
	type NodeAction,
	type NodeKind,
	PLAIN_KIND,
	type StepContext,
} from "../context";
import { RESUME_RULES } from "../resume-point";
import { scopeOf } from "../route";
import { heldStep } from "../run-position";
import { type OwnWait, pendingWaitOf } from "../sleep";
import type { PendingWait } from "../state";
import { type BodyResult, runStep, type StepHandle } from "../step-runner";

/** How often a Lease node that waits asks for its lease again, in minutes. */
export const LEASE_RETRY_MINUTES = 1;

/**
 * The Lease node (ADR 7): it takes a named lease of the run's Space
 * through the engine's keeper (`ctx.leases`), which asks this Replica's
 * store or the Space's Host.
 *
 * - `held`: the run holds the lease (`LeaseTaken` in the log). The engine
 *   lets go of it when the run ends, whatever ends it (`RunHolds`).
 * - `busy`: another run holds it, and the node does not wait
 *   (`waitMinutes` unset or 0) or waited long enough. `holder` names that
 *   run.
 * - Else the step sleeps through the sleep module (reason `lease`) and
 *   asks again every minute, as a Wait polls its command. A lease that
 *   goes on this computer wakes it at once (`wakeLeaseSleeps`). The
 *   pending wait's streak says when the wait began, so `waitMinutes`
 *   counts from the first ask.
 * - A Host that cannot be reached is not `busy`: nobody knows who holds
 *   the lease. The step waits for the Host, also past `waitMinutes`, as
 *   other work of the Space does.
 *
 * Both outcomes are the node's own. Only `held` ends the flow when no
 * edge leaves on it: a `busy` without an edge fails the run, so a person
 * sees that the lease was busy.
 */
export function leaseStepNode(node: LeaseNode, ctx: StepContext): NodeAction {
	return (state, config) => {
		const pending = pendingWaitOf(heldStep(state, node.id));
		return runStep(ctx, node, state, config, {
			rules: LEASE.resumeRules(node),
			outputs: (step) => ({
				visit: step.visit,
				name: renderName(node, step),
				waited_minutes: pending ? waitedMinutes(ctx, pending) : 0,
			}),
			body: (step) => askForLease(ctx, node, step, pending, config),
		});
	};
}

/** The Lease kind: a wait node for its waits; `held` is its chosen end; no step timer. */
export const LEASE: NodeKind<LeaseNode> = {
	...PLAIN_KIND,
	type: "lease",
	make: leaseStepNode,
	resumeRules: () => RESUME_RULES.wait,
	aux: () => [{ kind: "wait" }],
	isChosenEnd: (_node, outcome) => outcome === "held",
	endReason: () => null,
	timeBudget: () => ({ timeoutMinutes: undefined, idleMinutes: undefined }),
};

/** The lease's name, rendered: one line, trimmed. */
function renderName(node: LeaseNode, step: StepHandle): string {
	return renderTemplate(node.name, step.tctx).trim();
}

function waitedMinutes(ctx: StepContext, pending: PendingWait): number {
	return Math.round((ctx.now() - pending.streak.since) / ctx.minuteMs);
}

/**
 * Asks the keeper for the lease, on the first visit and on each wake, and
 * ends the step or sleeps again.
 */
async function askForLease(
	ctx: StepContext,
	node: LeaseNode,
	step: StepHandle,
	pending: PendingWait | null,
	config: LangGraphRunnableConfig,
): Promise<BodyResult> {
	const name = renderName(node, step);
	const waited = pending ? waitedMinutes(ctx, pending) : 0;
	const outputs: StepOutputs = {
		visit: step.visit,
		name,
		waited_minutes: waited,
	};
	if (step.signal.aborted) return { kind: "aborted", outputs };
	if (name === "") {
		return {
			kind: "end",
			outcome: "error",
			outputs,
			error: `The name of the lease is empty. Check the name of "${node.id}".`,
		};
	}
	const ttlMinutes = node.ttlMinutes;
	const answer: LeaseAnswer = await ctx.leases.take(ctx.run, {
		name,
		...(ttlMinutes !== undefined ? { ttlMinutes } : {}),
	});
	if (answer.kind === "held") {
		await ctx.log.append({
			type: "LeaseTaken",
			runId: ctx.run.id,
			stepId: step.stepId,
			payload: {
				name,
				nodeId: node.id,
				ttlMinutes: ttlMinutes ?? DEFAULT_LEASE_TTL_MINUTES,
				scope: scopeOf(config),
			},
		});
		step.record(null, { type: "lease", name, held: true });
		return { kind: "end", outcome: "held", outputs, error: null };
	}

	const now = ctx.now();
	const since = pending?.streak.since ?? now;
	const retry = now + LEASE_RETRY_MINUTES * ctx.minuteMs;
	if (answer.kind === "unreachable") {
		return sleep({
			until: retry,
			deadline: null,
			message: `Waits for the computer that keeps this Space, to take the lease "${name}".`,
			lease: { name, holder: null, holderTitle: null },
		});
	}

	const { holder } = answer;
	const deadline = since + (node.waitMinutes ?? 0) * ctx.minuteMs;
	if (now >= deadline) {
		step.record(null, {
			type: "lease",
			name,
			held: false,
			holder: holder.runId,
			holderTitle: holder.runTitle,
		});
		return {
			kind: "end",
			outcome: "busy",
			outputs: {
				...outputs,
				holder: holder.runId,
				holder_title: holder.runTitle,
			},
			error: null,
		};
	}
	return sleep({
		until: retry,
		deadline,
		message: `Waits for the lease "${name}". The run "${holder.runTitle}" holds it.`,
		lease: { name, holder: holder.runId, holderTitle: holder.runTitle },
	});
}

function sleep(wait: Omit<OwnWait, "reason">): BodyResult {
	return { kind: "sleep", reason: "lease", ...wait };
}
