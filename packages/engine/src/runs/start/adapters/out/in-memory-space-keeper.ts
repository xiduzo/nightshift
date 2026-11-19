import type { SpaceKeeper } from "../../application/ports";

/**
 * Who keeps each Space, in memory: this Replica, unless a test says a
 * Host keeps it (`hostedBy`). This computer reaches that Host only while a
 * test says so (`link`).
 */
export function inMemorySpaceKeeper() {
	const hosts = new Map<string, string>();
	const links = new Set<string>();
	const twin = {
		/** A Host keeps the Space. */
		hostedBy(spaceId: string, hostId: string) {
			hosts.set(spaceId, hostId);
		},
		/** Whether this computer reaches the Host of the Space now. */
		link(spaceId: string, up: boolean) {
			if (up) links.add(spaceId);
			else links.delete(spaceId);
		},

		async hostedElsewhere(spaceId: string) {
			return hosts.has(spaceId);
		},
		async reachable(spaceId: string) {
			return hosts.has(spaceId) && links.has(spaceId);
		},
		async hostOf(spaceId: string) {
			return hosts.get(spaceId) ?? null;
		},
	};
	return twin satisfies SpaceKeeper;
}

export type InMemorySpaceKeeper = ReturnType<typeof inMemorySpaceKeeper>;
