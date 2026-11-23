import { type AgentHarnessName, harnessTakesTools } from "@nightshift/flows";

const SWITCHES_MODEL_ON_RESUME: readonly AgentHarnessName[] = [
	"claude-code",
	"opencode",
	"codex",
];

/** Whether a chat can run on this harness. */
export function chatCanUseTools(harness: AgentHarnessName): boolean {
	return harnessTakesTools(harness);
}

/** Whether a session of this harness resumes on another model or effort. */
export function resumesOnAnotherModel(harness: AgentHarnessName): boolean {
	return SWITCHES_MODEL_ON_RESUME.includes(harness);
}
