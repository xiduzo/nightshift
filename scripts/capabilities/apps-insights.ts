import type { Place } from "../capabilities";
import { MECHANISM as M } from "./kinds";

/** The verticals of `apps/insights` (`scripts/capabilities.ts` says how to place one). */
export const APP_INSIGHTS: Record<string, Place> = {
	"features/access": "access",
	"features/days": "days",
	"features/feedback": "feedback",
	"features/funnel": "funnel",
	"features/ingest": "ingest",
	"features/ladders": "ladders",
	"features/mix": "mix",
	"features/overview": "overview",
	"features/proof": "proof",
	"features/reports": "reports",
	"features/retention": "retention",
	// The admin's own sign-in (Better Auth, its tables, the one admin).
	"shared/api": M,
	"shared/config": M,
	"shared/format": M,
	"shared/page": M,
	"shared/rpc": M,
	// The frame of the admin. It imports no feature: the route passes in
	// what it shows. So it is a mechanism, and V2 holds for it.
	"shared/shell": M,
};
