import type { TemplateContext } from "@nightshift/flows";
import { type Hold, type Scope, scopeKey } from "../../log";
import type { StepContext } from "../context";

/**
 * `{{stack.log_tail}}` of a service that runs: the end of its log as it is
 * now, not as it was when the service got ready. Only the services of this
 * flow's scope, by their node.
 */
export function withServiceTails(
	ctx: StepContext,
	tctx: TemplateContext,
	holds: readonly Hold[],
	scope: Scope | null,
): TemplateContext {
	const key = scopeKey(scope);
	let nodes: TemplateContext["nodes"] | null = null;
	for (const hold of holds) {
		if (hold.kind !== "service" || scopeKey(hold.scope) !== key) continue;
		const outputs = tctx.nodes[hold.nodeId];
		if (outputs === undefined) continue;
		nodes ??= { ...tctx.nodes };
		nodes[hold.nodeId] = {
			...outputs,
			log_tail: ctx.services.tail(hold.logPath),
		};
	}
	return nodes === null ? tctx : { ...tctx, nodes };
}
