import { planNodes } from "./application/plan-nodes";
import type { DeviceFit } from "./application/ports";

/**
 * The wiring of Placement: it binds the plan to the fit check and to what
 * a Device has. The engine's composition fills `fit` (`wire-start.ts`).
 * Placement builds no adapter of its own: the devices fill its port.
 */

export type PlacementDeps = { fit: DeviceFit };

export function wirePlacement(deps: PlacementDeps): {
	/** Plans a run over the Devices it may use. */
	planNodes: ReturnType<typeof planNodes>;
} {
	return { planNodes: planNodes({ fit: deps.fit }) };
}
