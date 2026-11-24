import type { Place } from "../capabilities";
import { MECHANISM as M, WIRING } from "./kinds";

/** The verticals of `apps/web` (`scripts/capabilities.ts` says how to place one). */
export const APP_WEB: Record<string, Place> = {
	"features/access": "access",
	"features/agents": "agents",
	"features/dashboard": "dashboard",
	"features/devices": "devices",
	"features/flows": "flows",
	"features/gates": "gates",
	"features/knowledge": "knowledge",
	"features/notifications": "notifications",
	"features/projects": "projects",
	"features/runs": "runs",
	"features/settings": "settings",
	"features/spaces": "spaces",
	"features/spend": "spend",
	"shared/agent-button": M,
	"shared/api": M,
	"shared/code": M,
	"shared/data-table": M,
	"shared/detail": M,
	"shared/failure": M,
	"shared/format": M,
	"shared/larger-window": M,
	"shared/markdown": M,
	"shared/media-query": M,
	"shared/moon": M,
	"shared/page": M,
	"shared/panel": M,
	// The mark of a run's status. Devices and runs both show it, as the
	// engine's `run-status` is a mechanism that `graph` and `runs` read.
	"shared/run-status": M,
	// The shell composes the features (rule 4).
	"shared/shell": WIRING,
	"shared/spread-strip": M,
	"shared/time": M,
	"shared/urgency": M,
	"shared/usage": M,
};
