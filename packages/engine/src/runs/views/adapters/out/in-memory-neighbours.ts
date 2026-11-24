import { type Actor, personOf } from "../../../../contract";
import type { PrivatePaths } from "../../application/ports";

/**
 * The private paths in memory: a test says which Person owns which Device
 * (`own`). A Person sees the worktree path of a run only on a Device they
 * own. Night Shift sees every path. It records each Space and actor it
 * was asked for.
 */
export function inMemoryPrivatePaths() {
	const owners = new Map<string, string>();
	const twin = {
		/** Each ask, in order. */
		asked: [] as { spaceId: string; actor: Actor }[],
		/** The Person who owns the Device. */
		own(deviceId: string, personId: string) {
			owners.set(deviceId, personId);
		},
		async for(spaceId: string, actor: Actor) {
			twin.asked.push({ spaceId, actor });
			const viewer = personOf(actor);
			return async <
				T extends {
					device: { id: string; thisDevice: boolean };
					worktreePath: string;
					takeOverCommand?: string | null;
				},
			>(
				view: T,
			): Promise<T> => {
				if (viewer === null || owners.get(view.device.id) === viewer) {
					return view;
				}
				return {
					...view,
					worktreePath: "",
					...("takeOverCommand" in view ? { takeOverCommand: null } : {}),
				};
			};
		},
	};
	return twin satisfies PrivatePaths;
}

export type InMemoryPrivatePaths = ReturnType<typeof inMemoryPrivatePaths>;
