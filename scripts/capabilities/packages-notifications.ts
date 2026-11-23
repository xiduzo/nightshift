import type { Place } from "../capabilities";
import { MECHANISM as M } from "./kinds";

/** The verticals of `packages/notifications` (`scripts/capabilities.ts` says how to place one). */
export const PACKAGE_NOTIFICATIONS: Record<string, Place> = {
	// The port every way to reach a screen implements, and Web Push.
	channels: M,
	// The keys of a notification, what a push carries, where a tap goes.
	contract: M,
	// The log of what the notifier sent.
	deliveries: M,
	// The channel to this computer's own desktop.
	desktop: M,
	// The rules, a Person's settings, and the push targets.
	notifications: "notifications",
};
