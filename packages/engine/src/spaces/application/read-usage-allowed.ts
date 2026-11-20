import { usageAllowed } from "../domain/policy";
import type { SpacePolicies } from "./ports";

export type ReadUsageAllowedPorts = {
	spacePolicies: Pick<SpacePolicies, "usageOn">;
};

/**
 * Whether this computer may send anonymous usage: false when any Space
 * it belongs to has usage turned off. Missing means on.
 */
export const readUsageAllowed =
	(ports: ReadUsageAllowedPorts) => async (): Promise<boolean> =>
		usageAllowed(await ports.spacePolicies.usageOn());
