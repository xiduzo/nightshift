import {
	type AgentChoice,
	suffixedName,
	withAgentProfiles,
} from "@nightshift/flows";
import { type Actor, personOf } from "../../../contract";
import { importedFlow, namesOf, type SavedFlow } from "../domain/flow-files";
import type {
	FlowUsage,
	ImportMigrations,
	SavedFlows,
	SpaceProjects,
} from "./ports";

export type ImportFlowPorts = {
	projects: SpaceProjects;
	flows: Pick<SavedFlows, "flows" | "save">;
	/** Without them, a node keeps its profile's name and its Device's name, to pick again. */
	importMigrations?: ImportMigrations | undefined;
	usage?: FlowUsage | undefined;
};

/**
 * Saves the flow of a JSON file as a new flow of a project of the Space,
 * a revision of kind `import` by the actor. An older format is brought up
 * to date first. A name the project has already gets a suffix (`-2`).
 * `agents` puts the person's own profiles in place of the agents the flow
 * names.
 */
export const importFlow =
	(ports: ImportFlowPorts) =>
	async (
		actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			name: string;
			json: string;
			agents?: readonly AgentChoice[];
		},
	): Promise<SavedFlow> => {
		const { spaceId, projectId } = request;
		const personId = personOf(actor) ?? undefined;
		await ports.projects.inSpace(projectId, spaceId);
		const flow = withAgentProfiles(
			importedFlow(
				request.json,
				await ports.importMigrations?.forScope({
					spaceId,
					personId: personId ?? null,
				}),
			),
			request.agents ?? [],
		);
		const free = suffixedName(
			request.name,
			namesOf(await ports.flows.flows(projectId)),
		);
		const issues = await ports.flows.save(projectId, free, flow, {
			kind: "import",
			personId,
		});
		ports.usage?.note({ kind: "flow-created", from: "import" });
		return { name: free, issues };
	};
