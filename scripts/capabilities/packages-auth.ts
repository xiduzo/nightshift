import type { Place } from "../capabilities";

/** The verticals of `packages/auth` (`scripts/capabilities.ts` says how to place one). */
export const PACKAGE_AUTH: Record<string, Place> = {
	access: "access",
	// What a paired Device signs in with on a Host.
	"device-keys": "devices",
	// Who may use this Host: one decision for every way in.
	"host-access": "access",
	// The session of this computer's own Person.
	"local-session": "access",
	// A Person's email and password.
	login: "access",
	// The device authorization that pairs a Device with a Host.
	pairing: "devices",
	spaces: "spaces",
	"two-factor": "access",
};
