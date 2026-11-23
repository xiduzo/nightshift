import type { Place } from "../capabilities";

/** The verticals of `packages/auth` (`scripts/capabilities.ts` says how to place one). */
export const PACKAGE_AUTH: Record<string, Place> = {
	access: "access",
	devices: "devices",
	spaces: "spaces",
};
