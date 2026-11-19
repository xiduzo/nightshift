import type { TargetStore } from "./ports";

export type ForgetTargetPorts = { targetStore: Pick<TargetStore, "forget"> };

/** Which target. */
export type ForgetTarget = { id: string };

/** Forgets a target its push service no longer knows. Night Shift asks, after a push comes back "gone". */
export const forgetTarget =
	(ports: ForgetTargetPorts) =>
	async (request: ForgetTarget): Promise<void> => {
		await ports.targetStore.forget([request.id]);
	};
