import { Refusal } from "@nightshift/refusal";

/**
 * Where a guided setup may act (ADR 25, Q22): only for a request from this
 * computer, never when Night Shift runs in a container, and only on the
 * systems whose installers it runs.
 */

/** Night Shift in a container, and the system of this computer (`darwin`). */
export type SetupPlace = { container: boolean; platform: string };

/** Why setup cannot act here. */
export type AgentSetupBlock = "elsewhere" | "container" | "platform";

/** The systems whose vendors' installers the setup runs (Q24: no Windows). */
const PLATFORMS: readonly string[] = ["darwin", "linux"];

export const AGENT_BLOCKED: Record<AgentSetupBlock, string> = {
	elsewhere: "Open Night Shift on that computer to set up an agent there.",
	container:
		"Night Shift runs in a container here, so an install would not last. Add the agent to its image.",
	platform: "Night Shift can set up an agent on macOS and Linux only.",
};

export const DECIDER_BLOCKED: Record<AgentSetupBlock, string> = {
	elsewhere: "Open Night Shift on that computer to set up a decider there.",
	container:
		"Night Shift runs in a container here. Its image has Ollama already. Choose the decider in Settings.",
	platform: "Night Shift can set up a decider on macOS and Linux only.",
};

/** Why setup cannot act for a request (`here`: from this computer). Null: it can. */
export function setupBlock(
	here: boolean,
	place: SetupPlace,
): AgentSetupBlock | null {
	if (!here) return "elsewhere";
	if (place.container) return "container";
	if (!PLATFORMS.includes(place.platform)) return "platform";
	return null;
}

/** Refuses a request that setup cannot act for, in the words of `blocked`. */
export function refuseBlocked(
	here: boolean,
	place: SetupPlace,
	blocked: Record<AgentSetupBlock, string>,
): void {
	const block = setupBlock(here, place);
	if (block) throw new Refusal("forbidden", blocked[block]);
}
