import type { Place } from "../capabilities";
import { MECHANISM as M } from "./kinds";

/** The verticals of `packages/insights` (`scripts/capabilities.ts` says how to place one). */
export const PACKAGE_INSIGHTS: Record<string, Place> = {
	client: M,
	ingest: "ingest",
	migrate: M,
	// The SQL of each admin page: what its numbers mean.
	queries: "reports",
	schema: M,
};
