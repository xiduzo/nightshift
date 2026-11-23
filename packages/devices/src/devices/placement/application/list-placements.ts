import type { PlacementModule } from "./create-placement";

/** Bound placements of the placement module. */
export function listPlacements(placement: Pick<PlacementModule, "placements">) {
	return placement.placements.bind(placement);
}
