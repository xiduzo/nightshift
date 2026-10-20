import { OPENCODE_MODELS } from "@tanstack/ai-opencode";
import { baseCheck, type CliCheck } from "../../doctor";
import type { HarnessAdapter } from "../harness-record";
import { OPENCODE_FACTS } from "./facts";

/** The version: Night Shift works with OpenCode 1.x only. */
async function opencodeCheck(bin: string): Promise<CliCheck> {
	const { resolved, ...check } = await baseCheck(bin, "OpenCode");
	if (!resolved || check.problem) return check;
	// "opencode v2.0.22" or "1.19.2".
	const version =
		check.version?.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? check.version;
	const major = version?.split(".")[0];
	if (major !== undefined && major !== "1") {
		return {
			...check,
			version,
			problem: `OpenCode ${version} is not supported. Night Shift works with OpenCode 1.x only. Install a 1.x version, or enter the path of one.`,
		};
	}
	return { ...check, version };
}

/** OpenCode in the harness registry. */
export const OPENCODE_ADAPTER: HarnessAdapter = {
	...OPENCODE_FACTS,
	models: OPENCODE_MODELS,
	check: opencodeCheck,
};
