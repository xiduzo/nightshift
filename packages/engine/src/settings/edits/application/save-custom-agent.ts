import { type CustomAgent, customAgentSchema } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type { SettingsStore } from "../../settings";
import {
	CUSTOM_AGENT_REMOVED,
	customAgentTaken,
} from "../domain/profile-edits";

export type SaveCustomAgentPorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	settings: Pick<SettingsStore, "current" | "save">;
};

/**
 * Adds a custom agent, or changes one (`previousSlug`). Its slug, the name
 * flows use, never changes. Refused when the slug is taken, or when the
 * agent of `previousSlug` is gone.
 * Only the owner of this computer may (`computerAccess.openComputer`).
 */
export const saveCustomAgent =
	(ports: SaveCustomAgentPorts) =>
	async (
		actor: Actor,
		request: { agent: CustomAgent; previousSlug?: string },
	): Promise<CustomAgent> => {
		ports.computerAccess.openComputer(actor);
		const { agent, previousSlug } = request;
		const agents = ports.settings.current().customAgents;
		if (previousSlug === undefined) {
			if (agents.some((a) => a.slug === agent.slug)) {
				throw new Refusal("conflict", customAgentTaken(agent.slug));
			}
			await ports.settings.save({ customAgents: [...agents, agent] });
			return customAgentSchema.parse(agent);
		}
		if (!agents.some((a) => a.slug === previousSlug)) {
			throw new Refusal("not-found", CUSTOM_AGENT_REMOVED);
		}
		const saved = customAgentSchema.parse({ ...agent, slug: previousSlug });
		await ports.settings.save({
			customAgents: agents.map((a) => (a.slug === previousSlug ? saved : a)),
		});
		return saved;
	};
