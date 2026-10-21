import type { OpenGate } from "@/shared/api";

/**
 * The Gates by project id, in the order of each project's oldest Gate. Two
 * Spaces can each have a project of the same name: they stay apart.
 */
export function groupByProject<G extends Pick<OpenGate, "projectId">>(
	gates: readonly G[],
): [string, G[]][] {
	const groups = new Map<string, G[]>();
	for (const gate of gates) {
		groups.set(gate.projectId, [...(groups.get(gate.projectId) ?? []), gate]);
	}
	return [...groups];
}
