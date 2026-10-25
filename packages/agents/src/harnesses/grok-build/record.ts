import type { GROK_BUILD_MODELS } from "@tanstack/ai-grok-build";
import type { HarnessAdapter } from "../harness-record";
import { GROK_BUILD_FACTS } from "./facts";

/**
 * The models `@tanstack/ai-grok-build` knows. A copy, so the registry does
 * not load the adapter: the type fails when the package's list changes.
 */
const MODELS = [
	"grok-build",
	"grok-build-0.1",
	"composer-2.5",
] as const satisfies typeof GROK_BUILD_MODELS;

/** Grok Build in the harness registry. Its check is the version only. */
export const GROK_BUILD_ADAPTER: HarnessAdapter = {
	...GROK_BUILD_FACTS,
	models: MODELS,
};
