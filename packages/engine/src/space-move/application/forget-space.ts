import type { MoveStore, SpaceEntries } from "./ports";

export type ForgetSpacePorts = {
	moveStore: Pick<MoveStore, "spaceExists" | "holdsRows" | "forgetRows">;
	spaceEntries: Pick<SpaceEntries, "forget">;
};

/**
 * Forgets a Space a move emptied: its answer costs, its facts of no run
 * here (a Member that joined) and its Space document. False, and nothing
 * removed, while the Space's own row, a Project or a run of it is here.
 * The merge asks, after it removed the Space's row. Runs again safely.
 */
export const forgetSpace =
	(ports: ForgetSpacePorts) =>
	async (request: { spaceId: string }): Promise<boolean> => {
		const { spaceId } = request;
		// The Space's own row is `@nightshift/auth`'s: its caller removes it first.
		if (await ports.moveStore.spaceExists(spaceId)) return false;
		if (await ports.moveStore.holdsRows(spaceId)) return false;
		await ports.moveStore.forgetRows(spaceId);
		await ports.spaceEntries.forget(spaceId);
		return true;
	};
