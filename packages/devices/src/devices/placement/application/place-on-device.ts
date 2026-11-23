import type { PlacementModule } from "./create-placement";

/** Bound deviceById of the placement module. */
export function placeOnDevice(placement: Pick<PlacementModule, "deviceById">) {
	return placement.deviceById.bind(placement);
}
