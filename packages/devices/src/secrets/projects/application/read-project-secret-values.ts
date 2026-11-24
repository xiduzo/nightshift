import { Refusal } from "@nightshift/refusal";
import type { HostCalls } from "../../calls";
import type { ProjectSecretStore, SpaceSecretStore } from "../../kept";
import {
	keptStepValues,
	NOT_YOUR_STEP,
	type StepAt,
} from "../domain/project-secrets";
import type { EnginePlaces, KeeperSpaces } from "./ports";

export type ReadProjectSecretValuesPorts = {
	spaces: KeeperSpaces;
	places: Pick<EnginePlaces, "runPlace">;
	store: Pick<ProjectSecretStore, "values">;
	spaceStore: Pick<SpaceSecretStore, "values">;
	calls: Pick<HostCalls, "ask">;
	/** How long one call of the Host may take. */
	deadlineMs: number;
};

/** The step's run, and the names it asks for (every one without names). */
export type ReadProjectSecretValues = {
	step: StepAt;
	names?: readonly string[] | undefined;
};

/**
 * Gives a step the secrets of its run's Project and Space. In a Space
 * this computer keeps: its own run of the Project, from its own store.
 * In a Space a Host keeps: at that Host, which checks the step. No name
 * asks nothing.
 *
 * Night Shift asks for a step: the use case takes the request alone.
 */
export const readProjectSecretValues =
	(ports: ReadProjectSecretValuesPorts) =>
	async (request: ReadProjectSecretValues): Promise<Record<string, string>> => {
		const { step, names } = request;
		if (names?.length === 0) return {};
		const hostId = await ports.spaces.hostOf(step.spaceId);
		if (hostId === null) {
			// This computer keeps the Space: its own run of the Project.
			const row = await ports.places.runPlace(step.runId);
			if (row?.spaceId !== step.spaceId || row.projectId !== step.projectId) {
				throw new Refusal("forbidden", NOT_YOUR_STEP);
			}
			return keptStepValues(
				{
					project: (projectId, asked) => ports.store.values(projectId, asked),
					space: (spaceId, asked) => ports.spaceStore.values(spaceId, asked),
				},
				step,
				names,
			);
		}
		return ports.calls.ask(
			hostId,
			(client) =>
				client.projectSecrets.values({
					...step,
					...(names ? { names: [...names] } : {}),
				}),
			{
				deadlineMs: ports.deadlineMs,
			},
		);
	};
