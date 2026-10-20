import type { FlowNode, FlowNodeType } from "@nightshift/flows";

import type { NodeKind } from "./context";
import { AGENT } from "./nodes/agent";
import { CALL } from "./nodes/call";
import { COMMAND } from "./nodes/command";
import { DECISION } from "./nodes/decision";
import { TOOL } from "./nodes/tool";
import { VALUE } from "./nodes/value";
import { WAIT } from "./nodes/wait";

/**
 * The node-kind descriptor and its registry: the one seam between a node
 * kind and the engine around it.
 *
 * Before this module a kind's engine facts were a switch spread over the
 * engine: `compile.ts` picked the factory and the auxiliary graph nodes,
 * `route.ts` knew which ends are chosen and what `RunEnded` says, the step
 * runner knew which steps write a command log and which have a time
 * budget, `runner.closeParked` knew the stopped outputs, `body.ts` knew the
 * Call's `ended` label and `run-start.ts` knew which kinds need a
 * connection, a harness or the decider. Adding the Tool node touched 16
 * files; adding the Wait node touched `state.ts`, `route.ts`, `context.ts`
 * and `runner.ts` on top of its own module.
 *
 * Now each node module exports one `NodeKind` (the interface is in
 * `context.ts`, next to what a node factory gets) next to its factory, and
 * `NODE_KINDS` lists them. The callers ask `kindOf(node)` instead of
 * switching. Locality: a kind's facts live in its module. Leverage: one
 * table test (`node-kinds.test.ts`) pins every fact for every kind.
 *
 * The deletion test picked the members: a fact is on the descriptor only
 * when deleting the switch in a caller would make the fact reappear there.
 * What is not here, on purpose: the zod union in `packages/flows` and the
 * web's `NODE_TYPE` record (inherent to a kind, out of this package); the
 * transcript-event unions in `log/step-events.ts` (one per kind, typed data, no
 * switch asks them); the `WaitReason` enum in `state.ts` (it enumerates a
 * Wait node's `until` kinds and the policy's reasons, not node kinds); and
 * which flow a Call calls (`run-start.calledFlowNames`, `runner.nodesOf`):
 * only a Call calls one, and both callers read `node.flow`.
 */

type KindOf<T extends FlowNodeType> = NodeKind<Extract<FlowNode, { type: T }>>;

/**
 * Every node kind, by type. Adding a kind is adding its module here.
 *
 * The entries are getters on purpose. A node module imports `route.ts` and
 * the step runner, which import this registry: a cycle. Whichever module
 * loads first, a descriptor is read here when a caller asks for it, after
 * every module evaluated, not while this one does (a plain `agent: AGENT`
 * would read a binding still in its temporal dead zone).
 */
export const NODE_KINDS: { readonly [T in FlowNodeType]: KindOf<T> } = {
	get agent() {
		return AGENT;
	},
	get command() {
		return COMMAND;
	},
	get tool() {
		return TOOL;
	},
	get decision() {
		return DECISION;
	},
	get value() {
		return VALUE;
	},
	get wait() {
		return WAIT;
	},
	get call() {
		return CALL;
	},
};

/**
 * The descriptor of a node, typed for any flow node. The registry is typed
 * per kind; a caller that holds a `FlowNode` gets the erased view and
 * passes that same node, so the cast holds.
 */
export function kindOf(node: FlowNode): NodeKind {
	return NODE_KINDS[node.type] as unknown as NodeKind;
}

/** The descriptor of a kind by its type name (a logged step's `nodeType`). */
export function kindOfType(type: FlowNodeType): NodeKind {
	return NODE_KINDS[type] as unknown as NodeKind;
}
