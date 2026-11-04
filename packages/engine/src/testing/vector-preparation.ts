import type {
	VectorPreparationEvent,
	VectorPreparationState,
} from "../knowledge/vector-preparation";

/**
 * Hears a vector preparation's events, so a test waits on the transition it
 * means instead of polling. Pass `onEvent` as the hook.
 */
export function watchVectorPreparation() {
	const states = new Map<string, VectorPreparationState>();
	const events: VectorPreparationEvent[] = [];
	let wake: (() => void)[] = [];
	const stateOf = (projectId: string) => states.get(projectId) ?? "idle";
	return {
		events,
		stateOf,
		onEvent(event: VectorPreparationEvent): void {
			events.push(event);
			states.set(event.projectId, event.to);
			for (const resolve of wake) resolve();
			wake = [];
		},
		/** Resolves once the project is in a state for which `until` is true. */
		async until(
			projectId: string,
			until: (state: VectorPreparationState) => boolean,
		): Promise<VectorPreparationState> {
			while (!until(stateOf(projectId))) {
				await new Promise<void>((resolve) => wake.push(resolve));
			}
			return stateOf(projectId);
		},
		/** Resolves once nothing runs or waits for the project. */
		settled(projectId: string): Promise<VectorPreparationState> {
			return this.until(
				projectId,
				(state) => state !== "queued" && state !== "preparing",
			);
		},
	};
}
