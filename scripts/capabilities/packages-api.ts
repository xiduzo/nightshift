import type { Place } from "../capabilities";
import { MECHANISM as M } from "./kinds";

/** The verticals of `packages/api` (`scripts/capabilities.ts` says how to place one). */
export const PACKAGE_API: Record<string, Place> = {
	assistant: "assistant",
	// This computer's configuration: settings, harnesses, profiles,
	// connections, CLI tools and the guided setup.
	settings: "settings",
	dashboard: "dashboard",
	devices: "devices",
	flows: "flows",
	gates: "gates",
	knowledge: "knowledge",
	notifications: "notifications",
	projects: "projects",
	runs: "runs",
	schedules: "schedules",
	spaces: "spaces",
	// Anonymous usage is not a word of the glossary. It is the export
	// that `telemetry` owns.
	usage: M,
};
