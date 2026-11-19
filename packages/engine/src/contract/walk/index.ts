/** What the walk of a run reads and decides nothing about: the run's plan (where its steps run, with their fallbacks) and the settings that apply. It imports nothing of the engine. */

export {
	type FallbackDevice,
	fallbackKey,
	type NodeFields,
	type PlannedDevice,
	type RunFallbacks,
	type RunPlan,
} from "./plan";
export type { WalkSettings } from "./settings";
