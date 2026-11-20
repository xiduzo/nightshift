import type { Place } from "../capabilities";
import { MECHANISM as M } from "./kinds";

/** The verticals of `packages/telemetry` (`scripts/capabilities.ts` says how to place one). */
export const PACKAGE_TELEMETRY: Record<string, Place> = {
	conventions: M,
	otlp: M,
	requests: M,
	// The runs of this computer as spans and metric points.
	runs: "runs",
	// The environment of a harness session while the export is on.
	sessions: M,
	usage: M,
};
