import type { PlacementModule } from "./create-placement";

/** Bound plan of the placement module. */
export function planRun(placement: Pick<PlacementModule, "plan">) {
	return placement.plan.bind(placement);
}
