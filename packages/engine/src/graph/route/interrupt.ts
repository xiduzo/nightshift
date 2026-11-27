import {
	Command,
	interrupt,
	isGraphInterrupt,
	type LangGraphRunnableConfig,
} from "@langchain/langgraph";

import { OUTRUN_ERROR } from "../../read";
import { outrun } from "../branches";
import type { NodeAction, StepContext } from "../context";
import { commitVisit, heldStep, holdEnded } from "../position";
import type {
	Parked,
	Pending,
	PendingGate,
	ResumeValue,
	RunStateValues,
} from "../state";

/**
 * The one interrupting graph node. Three nodes park a thread at an
 * interrupt: the wait node (a sleep, `graph/step/sleep.ts`), the park node (a
 * failed or stopped step, `graph/route/route.ts`) and the Gate's ask node
 * (`gateNode`). Each did the same three things with its own
 * `pending`: check it is this node's, interrupt with a copy of it, and jump
 * back on the answer. That skeleton lives here once; a node gives only what
 * differs: the copy the interrupt carries (`value`) and what its answer
 * does (`answer`).
 *
 * Nothing before `interrupt()` has a side effect (design rule 4): the node
 * re-runs on the resume, and only `answer` writes state. The interrupt
 * payloads (`Parked`) are the seam to the runner and the tests; this module
 * does not change them.
 *
 * A held step can be stale: a stop ended the open Gate or the sleep in the
 * log after the node held it, and before the hold was checkpointed (the
 * run position, `holdEnded`). No answer comes for it, so with no answer
 * waiting the node lets the step go (`letGo`) instead of waiting forever:
 * a Gate opens its visit again (`openAgain`), a sleep parks as stopped. An
 * answer that waits is taken as always.
 *
 * The resume value `hold` is taken here, for every such node: the node
 * jumps to itself and interrupts again in the next super-step, with the
 * same `pending`. Nothing runs before its `interrupt()`, so a held Gate
 * opens no second time and sends no second push, and a held sleep keeps
 * its time. The runner holds each interrupt it does not answer, so the
 * super-step ends and the answered branch goes on (`driveGraph`).
 */
export function interruptNode<K extends Pending["kind"]>(spec: {
	kind: K;
	nodeId: string;
	/** The error when nothing of this kind is pending at the node. */
	missing: string;
	/** What the interrupt carries: a copy of the pending step, as the runner reads it. */
	value(pending: Extract<Pending, { kind: K }>): Parked;
	/** What the resume does: the `Command` the node returns. A hold never gets here. */
	answer(
		pending: Extract<Pending, { kind: K }>,
		answer: Answer | undefined,
		state: RunStateValues,
		config: LangGraphRunnableConfig,
	): Command | Promise<Command>;
	/**
	 * A hold the log may have ended: the log to look in, and what the node
	 * does then. A held step on a branch another branch outran ends there.
	 */
	stale?: {
		ctx: Pick<StepContext, "log" | "run" | "bus" | "flow" | "races">;
		letGo(
			pending: Extract<Pending, { kind: K }>,
			state: RunStateValues,
			config: LangGraphRunnableConfig,
		): Command | Promise<Command>;
	};
}): NodeAction {
	return async (state, config) => {
		const pending = heldStep(state, spec.nodeId);
		if (pending?.kind !== spec.kind) {
			throw new Error(spec.missing);
		}
		const own = pending as Extract<Pending, { kind: K }>;
		let answer: ResumeValue | undefined;
		try {
			answer = interrupt<Parked, ResumeValue | undefined>(spec.value(own));
		} catch (error) {
			// No answer waits. A stale hold gets none: the node lets it go.
			const { stale } = spec;
			if (
				isGraphInterrupt(error) &&
				stale &&
				holdEnded(await stale.ctx.log.state(stale.ctx.run.id), own)
			) {
				return stale.letGo(own, state, config);
			}
			throw error;
		}
		// A hold: the node waits again, with the same state, in the next
		// super-step. It writes nothing, so its step, its Gate and its timer
		// stay as they are.
		if (answer?.kind === "hold") {
			const { stale } = spec;
			if (
				stale &&
				own.stepId !== null &&
				outrun(stale.ctx, state, { id: spec.nodeId }, config)
			) {
				return endOutrun(stale.ctx, spec.nodeId, {
					stepId: own.stepId,
					visit: own.visit,
				});
			}
			return holdAgain(config);
		}
		return spec.answer(own, answer, state, config);
	};
}

/** What an interrupting node's answer can be: anything but a hold, which `interruptNode` takes. */
type Answer = Exclude<ResumeValue, { kind: "hold" }>;

/**
 * A held Gate or sleep on a branch that another branch outran at a `first`
 * Join: its step ends `stopped` as an outrun step does, and the branch goes
 * no further. Its Gate closes, and its sleep ends with it.
 */
async function endOutrun(
	ctx: Pick<StepContext, "log" | "run" | "bus">,
	nodeId: string,
	held: { stepId: string; visit: number },
): Promise<Command> {
	await ctx.log.append({
		type: "StepEnded",
		runId: ctx.run.id,
		stepId: held.stepId,
		payload: {
			outcome: "stopped",
			outputs: { visit: held.visit, outcome: "stopped" },
			error: OUTRUN_ERROR,
		},
	});
	ctx.bus.publish(ctx.run.id, { kind: "step-changed", stepId: held.stepId });
	return new Command({
		update: {
			pending: { [nodeId]: null },
			...commitVisit({ id: nodeId }, held.visit),
		},
	});
}

/** The interrupting node runs again in the next super-step and interrupts with what it holds. */
function holdAgain(config: LangGraphRunnableConfig): Command {
	const self = config.metadata?.langgraph_node;
	if (typeof self !== "string") {
		throw new Error("A held node does not know its own name.");
	}
	return new Command({ goto: self });
}

type GateSpec = Parameters<typeof interruptNode<"gate">>[0];

/** The node opens its Gate again, in a new visit. */
export function askAgain(node: { id: string }): Command {
	return new Command({
		update: { pending: { [node.id]: null } },
		goto: node.id,
	});
}

/**
 * The visit of a Gate that a stop closed is open again, and the node goes
 * on from its resume point. A sleep, a park or an earlier stop may have
 * committed that visit while its step went on. The log says how the step
 * ended, so a step that is done does not run again (`Position.done`).
 */
export function openAgain(
	node: { id: string },
	pending: Pick<PendingGate, "visit">,
): Command {
	return new Command({
		update: {
			pending: { [node.id]: null },
			...commitVisit(node, pending.visit - 1),
		},
		goto: node.id,
	});
}

/**
 * The ask node of a Gate (`ask__<id>`): it waits with the Gate the node
 * opened. A stop can end the Gate's step before the Gate was checkpointed.
 * Then the node goes on from its resume point (`openAgain`): an Agent that
 * asks takes the step up when it has a session, each other Gate asks again
 * in a new visit.
 */
export function gateNode(
	node: { id: string },
	ctx: Pick<StepContext, "log" | "run" | "bus" | "flow" | "races">,
	spec: {
		answer: GateSpec["answer"];
		/** What opens at the node, in the error when none is. Default: a Gate. */
		what?: "question";
	},
): NodeAction {
	return interruptNode({
		kind: "gate",
		nodeId: node.id,
		missing: `No ${spec.what ?? "Gate"} is open at node "${node.id}".`,
		value: (pending) => ({
			kind: "gate",
			stepId: pending.stepId,
			nodeId: node.id,
			question: pending.question,
			choices: pending.choices,
			...(pending.deadline ? { deadline: pending.deadline } : {}),
		}),
		answer: spec.answer,
		stale: { ctx, letGo: (pending) => openAgain(node, pending) },
	});
}
