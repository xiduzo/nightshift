import { Refusal } from "@nightshift/refusal";
import type { Caller } from "../../../contract";
import type { ProjectSecretStore, SpaceSecretStore } from "../../kept";
import {
	keptHere,
	keptStepValues,
	NOT_IN_SPACE,
	NOT_YOUR_STEP,
	type StepAt,
} from "../domain/project-secrets";
import type {
	EnginePlaces,
	KeeperSpaces,
	PlacedSteps,
	SpaceOffers,
} from "./ports";

export type ReadStepSecretValuesPorts = {
	places: EnginePlaces;
	spaces: KeeperSpaces;
	work: PlacedSteps;
	offers: SpaceOffers;
	store: Pick<ProjectSecretStore, "values">;
	spaceStore: Pick<SpaceSecretStore, "values">;
};

/** The step's run, and the names it asks for (every one without names). */
export type ReadStepSecretValues = StepAt & { names?: readonly string[] };

/**
 * Gives a step the secrets of its run's Project and Space that this Host
 * keeps: the run is of that Project in that Space, and its step runs on
 * the Caller's Device now (the work hub has a call of the run out to it,
 * or the Device walks the run itself). The Device's Person is a Member
 * of the Space, or the Device offers profiles to it: another Person's
 * Device that runs a step under an Offer gets them, for that run only.
 *
 * A paired Device asks: the use case takes the Caller.
 */
export const readStepSecretValues =
	(ports: ReadStepSecretValuesPorts) =>
	async (
		caller: Caller,
		request: ReadStepSecretValues,
	): Promise<Record<string, string>> => {
		const { names, ...step } = request;
		await keptHere(ports.places.spaceOf, ports.spaces.hostOf, step);
		const row = await ports.places.runPlace(step.runId);
		if (
			!row ||
			row.spaceId !== step.spaceId ||
			row.projectId !== step.projectId ||
			!(
				row.walkerId === caller.deviceId ||
				ports.work.placed(caller.deviceId, step)
			)
		) {
			throw new Refusal("forbidden", NOT_YOUR_STEP);
		}
		if (
			!(await caller.member(step.spaceId)) &&
			!(await ports.offers.offersInto(caller.deviceId, step.spaceId))
		) {
			throw new Refusal("forbidden", NOT_IN_SPACE);
		}
		return keptStepValues(
			{
				project: (projectId, asked) => ports.store.values(projectId, asked),
				space: (spaceId, asked) => ports.spaceStore.values(spaceId, asked),
			},
			step,
			names,
		);
	};
