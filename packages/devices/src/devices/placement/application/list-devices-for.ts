import type { PlacementModule } from "./create-placement";

/** Bound devicesFor of the placement module. */
export function listDevicesFor(placement: Pick<PlacementModule, "devicesFor">) {
	return placement.devicesFor.bind(placement);
}
