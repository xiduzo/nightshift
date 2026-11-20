import type { SpacePolicies } from "../../application/ports";

/**
 * `SpacePolicies` in memory: the usage of each Space (missing means on),
 * and the Spaces a Host keeps. A test sets them (`add`, `hostedElsewhere`).
 * Test code.
 */
export function inMemorySpacePolicies() {
	const usage = new Map<string, boolean | undefined>();
	const hosted = new Set<string>();
	const twin = {
		/** A Space this Replica has, with its usage as its document says (missing: on). */
		add(spaceId: string, enabled?: boolean) {
			usage.set(spaceId, enabled);
		},
		/** A Space another Replica keeps. */
		hostedElsewhere(spaceId: string) {
			hosted.add(spaceId);
			if (!usage.has(spaceId)) usage.set(spaceId, undefined);
		},
		/** The usage of the Space as its document says: undefined is missing. */
		usageOf(spaceId: string) {
			return usage.get(spaceId);
		},
		async setUsage(spaceId: string, enabled: boolean) {
			if (hosted.has(spaceId)) return false;
			usage.set(spaceId, enabled);
			return true;
		},
		async usageOn() {
			return [...usage.values()].map((enabled) => enabled !== false);
		},
	};
	return twin satisfies SpacePolicies;
}

export type InMemorySpacePolicies = ReturnType<typeof inMemorySpacePolicies>;
