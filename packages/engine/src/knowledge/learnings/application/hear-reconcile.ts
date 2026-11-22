import type { KnowledgeReconciled } from "../../sync";
import { waitingKey } from "../domain/waiting";
import type { LearningsNotifications } from "./ports";

export type HearReconcilePorts = {
	notifications: LearningsNotifications;
	/** What waited at the last reconcile of each project in this process. The wire makes it once. */
	known: Map<string, string>;
};

/**
 * A reconcile ended. Every way what waits can change comes through here:
 * a person who settles, a step's proposals, a review by the kit, and each
 * of them on another Device. So one reconcile tells the screens once, and
 * only when what waits is not what it was.
 */
export const hearReconcile =
	(ports: HearReconcilePorts) =>
	async ({
		projectId,
		spaceId,
		held,
		listed,
	}: KnowledgeReconciled): Promise<void> => {
		const before =
			ports.known.get(projectId) ?? waitingKey(Object.entries(held));
		const after = waitingKey(listed);
		ports.known.set(projectId, after);
		if (before === after) return;
		await ports.notifications
			.learningsChanged(spaceId, projectId)
			.catch((error: unknown) => {
				console.warn("The screens were not told of the learnings:", error);
			});
	};
