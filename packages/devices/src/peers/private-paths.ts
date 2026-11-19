import type { Database } from "@nightshift/db";
import { type Actor, personOf } from "@nightshift/engine";
import { personInSpace } from "../links";

/**
 * A run as a Person may read it: where its worktree is on its Device
 * (and the take-over command that names it) only for that Device's
 * owner. Another Person's Device, or one this Replica cannot tell the
 * owner of, shows none: the path stays with the Device's owner, as the
 * exchange keeps the Walker's paths with the Walker's.
 */
export function createPrivatePaths(deps: {
	db: Database;
	/** A Device row by id: whose Device it is. */
	registry: {
		get(deviceId: string): Promise<{ ownerId: string } | null>;
	};
	/** The Person who owns this computer, or null before the engine knows. */
	ownerId(): string | null;
}) {
	const { db, registry } = deps;
	return async function pathsFor(spaceId: string, actor: Actor | undefined) {
		const person = actor ? personOf(actor) : null;
		const viewer =
			person !== null ? await personInSpace(db, spaceId, person) : null;
		const here = await personInSpace(db, spaceId, deps.ownerId());
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
