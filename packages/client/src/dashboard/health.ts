import type { NightRange } from "./types";

/**
 * The nights Flow health covers: the server counts each flow's runs over
 * the last 30 nights (`flowHealth` of the summary). A screen that shows how
 * the projects did over the same window picks this range of
 * `summary.nights` (one of the ranges the reply has).
 */
export const HEALTH_NIGHTS: NightRange = 30;
