import type { Place } from "../capabilities";
import { MECHANISM as M } from "./kinds";

/** The verticals of `packages/semconv` (`scripts/capabilities.ts` says how to place one). */
export const PACKAGE_SEMCONV: Record<string, Place> = {
	registry: M,
};
