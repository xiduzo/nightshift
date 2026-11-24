import {
	type AgentChoice,
	starterList,
	withAgentProfiles,
} from "@nightshift/flows";
import { type Actor, personOf } from "../../../contract";
import type { ProjectFlows } from "../../store";
import {
	migratedFlow,
	namesOf,
	type StarterImport,
} from "../domain/flow-files";
import type { FlowUsage, ImportMigrations, SpaceProjects } from "./ports";

export type ImportStartersPorts = {
	projects: SpaceProjects;
	flows: Pick<ProjectFlows, "flows" | "save">;
	importMigrations?: ImportMigrations | undefined;
	usage?: FlowUsage | undefined;
};

/**
 * Saves the starters that ship with Night Shift as flows of a project of
 * the Space, each a revision of kind `import` by the actor. A starter
 * whose name the project has already is skipped: its flow stays as it
 * is, and no starter takes another name, as the starters call each other
 * by name.
 */
export const importStarters =
	(ports: ImportStartersPorts) =>
	async (
		actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			agents?: readonly AgentChoice[];
		},
	): Promise<StarterImport> => {
		const { spaceId, projectId } = request;
		const personId = personOf(actor) ?? undefined;
		await ports.projects.inSpace(projectId, spaceId);
		const migration = await ports.importMigrations?.forScope({
			spaceId,
			personId: personId ?? null,
		});
		const taken = namesOf(await ports.flows.flows(projectId));
		const result: StarterImport = { imported: [], skipped: [] };
		for (const starter of starterList()) {
			if (taken.has(starter.name)) {
				result.skipped.push(starter.name);
				continue;
			}
			await ports.flows.save(
				projectId,
				starter.name,
				withAgentProfiles(
					migratedFlow(starter.source, migration),
					request.agents ?? [],
				),
				{ kind: "import", personId },
			);
			ports.usage?.note({
				kind: "flow-created",
				from: "starter",
				starter: starter.name,
			});
			result.imported.push(starter.name);
		}
		return result;
	};
