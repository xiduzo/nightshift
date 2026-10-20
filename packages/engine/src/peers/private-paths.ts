import type { Database } from "@nightshift/db";
import type { Actor } from "../contract";
import { personOnHost } from "./exchange/host-spaces";
import type { DeviceRegistry } from "./registry";

/**
 * A run as a Person may read it: where its worktree is on its Device
 * (and the take-over command that names it) only for that Device's
 * owner. Another Person's Device, or one this Replica cannot tell the
 * owner of, shows none: the path stays with the Device's owner, as the
 * exchange keeps the Walker's paths with the Walker's.
 */
export function createPrivatePaths(deps: {
	db: Database;
	registry: Pick<DeviceRegistry, "get">;
	/** The Person who owns this computer, or null before the engine knows. */
	ownerId(): string | null;
}) {
	const { db, registry } = deps;
	return async function pathsFor(spaceId: string, actor: Actor | undefined) {
		const viewer = actor
			? ((await personOnHost(db, spaceId)) ?? actor.personId)
			: null;
		const here = (await personOnHost(db, spaceId)) ?? deps.ownerId();
		const owners = new Map<string, string | null>();
		return async <
			T extends {
				device: { id: string; thisDevice: boolean };
				worktreePath: string;
				takeOverCommand?: string | null;
			},
		>(
			summary: T,
		): Promise<T> => {
			if (viewer === null) return summary;
			const { id, thisDevice } = summary.device;
			if (!owners.has(id)) {
				owners.set(
					id,
					thisDevice ? here : ((await registry.get(id))?.ownerId ?? null),
				);
			}
			if (owners.get(id) === viewer) return summary;
			return {
				...summary,
				worktreePath: "",
				...("takeOverCommand" in summary ? { takeOverCommand: null } : {}),
			};
		};
	};
}
