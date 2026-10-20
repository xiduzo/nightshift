import { GROK_BUILD_MODELS } from "@tanstack/ai-grok-build";
import type { HarnessAdapter } from "../harness-record";
import { GROK_BUILD_FACTS } from "./facts";

/** Grok Build in the harness registry. Its check is the version only. */
export const GROK_BUILD_ADAPTER: HarnessAdapter = {
	...GROK_BUILD_FACTS,
	models: GROK_BUILD_MODELS,
};
