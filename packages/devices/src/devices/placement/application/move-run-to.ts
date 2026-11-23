import type { PlacementModule } from "./create-placement";

/** Bound moveTo of the placement module. */
export function moveRunTo(placement: Pick<PlacementModule, "moveTo">) {
	return placement.moveTo.bind(placement);
}
