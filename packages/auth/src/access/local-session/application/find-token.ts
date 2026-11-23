import type { TokenCell } from "../domain/local-token";
import type { Sessions } from "./ports";

export type FindTokenPorts = {
	sessions: Pick<Sessions<unknown>, "latest" | "create">;
	token: TokenCell;
	now: () => number;
};

/** Whose session. */
export type FindToken = { personId: string };

/**
 * The token of the local session: the one in memory while it lives, else
 * the Person's session that expires last, else a new one.
 */
export const findToken =
	(ports: FindTokenPorts) =>
	async (request: FindToken): Promise<string> => {
		const now = ports.now();
		const live = ports.token.live(now);
		if (live !== null) return live;
		const found =
			(await ports.sessions.latest(request.personId, now)) ??
			(await ports.sessions.create(request.personId));
		return ports.token.keep(found);
	};
