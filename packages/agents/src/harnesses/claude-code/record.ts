import { CLAUDE_CODE_MODELS } from "@tanstack/ai-claude-code";
import { baseCheck, type CliCheck, probe } from "../../doctor";
import type { HarnessAdapter } from "../harness-record";
import { CLAUDE_CODE_FACTS } from "./facts";

/** The version, and whose Claude login it uses (`claude auth status --json`). */
async function claudeCheck(bin: string): Promise<CliCheck> {
	const { resolved, ...check } = await baseCheck(bin, "Claude Code");
	if (!resolved || check.problem) return check;
	try {
		const out = await probe([resolved, "auth", "status", "--json"]);
		const status = JSON.parse(out.stdout) as {
			loggedIn?: boolean;
			email?: string;
			orgName?: string;
			subscriptionType?: string;
			authMethod?: string;
		};
		if (!status.loggedIn) {
			return {
				...check,
				problem: "Not logged in. Run `claude` once to log in.",
			};
		}
		const facts = [
			status.subscriptionType && {
				label: "Plan",
				value: status.subscriptionType,
			},
			status.orgName && { label: "Organization", value: status.orgName },
			status.authMethod && { label: "Login", value: status.authMethod },
		].filter((f): f is { label: string; value: string } => Boolean(f));
		return { ...check, account: status.email ?? null, facts };
	} catch {
		// An older Claude Code without `auth status --json`: the version is enough.
		return check;
	}
}

/** Claude Code in the harness registry. */
export const CLAUDE_CODE_ADAPTER: HarnessAdapter = {
	...CLAUDE_CODE_FACTS,
	models: CLAUDE_CODE_MODELS,
	check: claudeCheck,
};
