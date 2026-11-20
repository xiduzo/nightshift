import type { Place } from "../capabilities";
import { MECHANISM as M, WIRING } from "./kinds";

/** The verticals of `apps/mobile` (`scripts/capabilities.ts` says how to place one). */
export const APP_MOBILE: Record<string, Place> = {
	// This phone's sign-in on its Host, and the session.
	"features/access": "access",
	"features/devices": "devices",
	// The Needs-you inbox, one Gate in full, and the Needs you queue with
	// the bar that sends an answer.
	"features/gates": "gates",
	// This phone's notifications.
	"features/notifications": "notifications",
	// One run live, and the Runs tab (`tab/`): the runs on their way
	// and tonight's schedules.
	"features/runs": "runs",
	"features/schedules": "schedules",
	"features/settings": "settings",
	"features/spaces": "spaces",
	// The home screen widget and the followed run on the lock screen.
	"features/widgets": "widgets",
	"shared/api": M,
	"shared/avatar": M,
	"shared/clock": M,
	"shared/empty": M,
	"shared/feedback": M,
	"shared/format": M,
	"shared/header": M,
	"shared/in-front": M,
	"shared/list": M,
	"shared/markdown": M,
	"shared/native-list": M,
	"shared/page": M,
	"shared/refresh": M,
	// The shell composes the features (rule 4).
	"shared/shell": WIRING,
	"shared/status": M,
	"shared/theme": M,
	"shared/tone": M,
	"shared/trail": M,
};
