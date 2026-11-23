import {
	endedPhones,
	type PushTarget,
	phoneSessionsOf,
} from "../domain/push-targets";
import type { Sessions, TargetStore } from "./ports";

export type ListTargetsPorts = {
	targetStore: Pick<TargetStore, "of" | "forget">;
	sessions: Pick<Sessions, "live">;
	clock: () => number;
};

/** Whose push targets. */
export type ListTargets = { personId: string };

/**
 * The Person's push targets, oldest first. A phone whose session ended is
 * forgotten here, not only left out: the phone may hold another Person's
 * session by now. Night Shift asks before it pushes, and a list for the
 * Person starts here.
 */
export const listTargets =
	(ports: ListTargetsPorts) =>
	async (request: ListTargets): Promise<PushTarget[]> => {
		const targets = await ports.targetStore.of(request.personId);
		const phoneSessions = phoneSessionsOf(targets);
		if (phoneSessions.length === 0) return targets;
		const live = await ports.sessions.live(phoneSessions, ports.clock());
		const ended = endedPhones(targets, live);
		if (ended.length === 0) return targets;
		await ports.targetStore.forget(ended.map((target) => target.id));
		return targets.filter((target) => !ended.includes(target));
	};
