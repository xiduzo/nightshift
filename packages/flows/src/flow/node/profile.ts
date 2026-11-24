import type { ProfileRef } from "../../nodes";
import type { FlowNode } from "../schema";
import { tierUsers } from "./cascade";

/**
 * The profile a node names, when its kind reads one: an Agent, or a
 * Decision or a Value decided by a model.
 */
export function profileOf(node: FlowNode): ProfileRef | undefined {
	if (node.type === "agent") return node.profile;
	if (node.type === "decision" || node.type === "value") {
		return node.by === "model" ? node.profile : undefined;
	}
	return undefined;
}

/**
 * Every profile a node names: its own, or each tier's of its cascade
 * (ADR 6). Each tier's profile places that tier's tries.
 */
export function nodeProfiles(node: FlowNode): ProfileRef[] {
	const own = profileOf(node);
	if (own !== undefined) return [own];
	return tierUsers(node).flatMap(({ node: tier }) => {
		const profile = profileOf(tier);
		return profile === undefined ? [] : [profile];
	});
}
