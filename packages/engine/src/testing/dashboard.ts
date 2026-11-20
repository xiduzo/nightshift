import type { Engine } from "../engine";
import { wireEngineDashboard } from "../wire-dashboard";

/**
 * `Engine.dashboard` over these Space views, as `createEngine` wires it:
 * for a test that fakes the engine's `space`.
 */
export function dashboardOver(space: Engine["space"]): Engine["dashboard"] {
	return wireEngineDashboard({ space });
}
