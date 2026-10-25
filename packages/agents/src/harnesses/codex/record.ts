import type { CODEX_MODELS } from "@tanstack/ai-codex";
import { baseCheck, type CliCheck, firstLine, probe } from "../../doctor";
import type { HarnessAdapter } from "../harness-record";
import { CODEX_FACTS } from "./facts";

/** The version, and the login (`codex login status`). */
async function codexCheck(bin: string): Promise<CliCheck> {
	const { resolved, ...check } = await baseCheck(bin, "Codex");
	if (!resolved || check.problem) return check;
	try {
		const out = await probe([resolved, "login", "status"]);
		const line = firstLine(out.stdout) ?? firstLine(out.stderr);
		if (out.code !== 0) {
			return {
				...check,
				problem: line ?? "Not logged in. Run `codex login`.",
			};
		}
		return { ...check, account: line };
	} catch {
		return check;
	}
}

/**
 * The models `@tanstack/ai-codex` knows. A copy, so the registry does not
 * load the adapter: the type fails when the package's list changes.
 */
const MODELS = [
	"gpt-5.3-codex",
	"gpt-5.2-codex",
	"gpt-5.1-codex",
	"gpt-5.1-codex-mini",
	"gpt-5.1",
] as const satisfies typeof CODEX_MODELS;

/** Codex in the harness registry. */
export const CODEX_ADAPTER: HarnessAdapter = {
	...CODEX_FACTS,
	models: MODELS,
	check: codexCheck,
};
