import { Command, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { CascadeNode, PersonTier } from "@nightshift/flows";
import {
	climbAt,
	climbCommand,
	climbLines,
	climbOutputs,
	RETRY_GATE_CHOICES,
	tryAgain,
} from "../cascade";
import type { NodeAction, StepContext } from "../context";
import { interruptNode } from "../interrupt";
import { route } from "../route";
import type {
	CascadePosition,
	CascadeTry,
	PendingGate,
	ResumeValue,
	RunStateValues,
} from "../state";
import { type GateAsk, gateChooser, resolve } from "./choosers/person";

/**
 * The person tier of an Agent's or a Call's cascade (ADR 6): a Gate on a
 * step of its own, after the last tier did not hold. It shows what each
 * try did and offers "try-again" (one more try on the last tier, with the
 * person's note) and "stop" (the step ends `fail` and routes). The Gate is
 * a Gate like any other: the inbox, the phone, a deadline and a restart
 * treat it the same. Its step has no timers.
 */

/** What the person tier asks. */
function retryAsk(
	node: CascadeNode,
	at: CascadePosition,
	tier: PersonTier,
): GateAsk {
	const last = at.trail.at(-1);
	return {
		question: () =>
			`No tier finished this step. What each try did:\n${climbLines(at.trail)}`,
		choices: [...RETRY_GATE_CHOICES],
		deadline: tier.deadline,
		outputs: {
			...climbOutputs(node, at),
			summary: last?.summary ?? "",
			...(last?.log_tail !== undefined ? { log_tail: last.log_tail } : {}),
		},
		climb: true,
	};
}

/** Opens the person tier's Gate: the node's visit at that tier. */
export function retryGate(
	node: CascadeNode,
	ctx: StepContext,
	at: CascadePosition,
	tier: PersonTier,
): NodeAction {
	return gateChooser(node, ctx, retryAsk(node, at, tier));
}

/**
 * The answer at the person tier: "try-again" ends the step `try-again` and
 * climbs back to the last tier with the note; "stop" ends it `fail` and
 * routes on. A reopen (the run was stopped at the Gate and resumed) asks
 * again in a new visit.
 */
export async function answerRetryGate(
	ctx: StepContext,
	node: CascadeNode,
	pending: PendingGate,
	answer: ResumeValue | undefined,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
): Promise<Command> {
	if (answer?.kind !== "gate") return askAgain(node);
	const done = await resolve(
		ctx,
		node,
		state,
		config,
		pending,
		answer,
		(choice) =>
			choice === "try-again"
				? { outcome: "try-again", climbs: true }
				: { outcome: "fail", climbs: false },
	);
	if (done.kind === "parked") return done.command;
	const { end } = done;
	if (end.outcome !== "try-again") return route(ctx, state, node, end, config);
	const note = typeof end.outputs.note === "string" ? end.outputs.note : "";
	return climbCommand(node, end, tryAgain(node, climbAt(state, node), note));
}

/** The node opens its person tier's Gate again, in a new visit. */
function askAgain(node: CascadeNode): Command {
	return new Command({
		update: { pending: { [node.id]: null } },
		goto: node.id,
	});
}

/** The ask node of a Call whose cascade ends with a person (`ask__<id>`). */
export function climbAskNode(node: CascadeNode, ctx: StepContext): NodeAction {
	return interruptNode({
		kind: "gate",
		nodeId: node.id,
		missing: `No Gate is open at node "${node.id}".`,
		value: (pending) => ({
			kind: "gate",
			stepId: pending.stepId,
			nodeId: node.id,
			question: pending.question,
			choices: pending.choices,
			...(pending.deadline ? { deadline: pending.deadline } : {}),
		}),
		answer: (pending, answer, state, config) =>
			answerRetryGate(ctx, node, pending, answer, state, config),
		stale: { ctx, letGo: () => askAgain(node) },
	});
}

/**
 * What an Agent's next try is told of the try before (ADR 6.6): how it
 * ended, what it said, the check's log tail, and the person's note.
 */
export function previousFailure(
	previous: CascadeTry,
	check: string | undefined,
	note: string | undefined,
): string {
	const lines = [
		`The try before this one (tier ${previous.tier}, try ${previous.try}) did not finish the task. It ended ${previous.outcome}.`,
	];
	if (previous.summary.trim() !== "") lines.push(previous.summary.trim());
	if (check !== undefined && previous.log_tail !== undefined) {
		lines.push(
			`The check \`${check}\` failed. The end of its output:\n\`\`\`\n${previous.log_tail.trimEnd()}\n\`\`\``,
		);
	}
	if (note !== undefined && note.trim() !== "") {
		lines.push(`A person adds: ${note.trim()}`);
	}
	return lines.join("\n\n");
}
