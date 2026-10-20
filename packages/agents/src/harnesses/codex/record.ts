import { CODEX_MODELS } from "@tanstack/ai-codex";
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

/** Codex in the harness registry. */
export const CODEX_ADAPTER: HarnessAdapter = {
	...CODEX_FACTS,
	models: CODEX_MODELS,
	check: codexCheck,
};
