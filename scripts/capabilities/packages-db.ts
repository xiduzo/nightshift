import type { Place } from "../capabilities";
import { MECHANISM as M } from "./kinds";

/** The verticals of `packages/db` (`scripts/capabilities.ts` says how to place one). */
export const PACKAGE_DB: Record<string, Place> = {
	client: M,
	"data-dir": M,
	migrate: M,
	schema: M,
};
