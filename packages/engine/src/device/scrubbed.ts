import { PAGE_READER_ENV } from "@nightshift/flows";

/**
 * The page reader of a step is its project's (ADR 39). The one that Night
 * Shift itself was started with does not reach a step.
 */
export const PAGE_READER_NAMES: readonly string[] =
	Object.values(PAGE_READER_ENV);
