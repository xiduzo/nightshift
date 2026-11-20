import { Refusal } from "@nightshift/refusal";
import {
	HOSTED_ELSEWHERE,
	PROJECT_NOT_FOUND,
	type ProjectDirectory,
	type ProjectStore,
} from "../../keep";
import { NO_SUCH_SPACE } from "../domain/move";
import type { KnownSpaces } from "./ports";

export type CheckProjectMovePorts = {
	store: Pick<ProjectStore, "row">;
	directory: Pick<ProjectDirectory, "hostedElsewhere">;
	knownSpaces: KnownSpaces;
};

/** The project, the Space it is in, and the Space it would go to. */
export type CheckProjectMove = { projectId: string; from: string; to: string };

/**
 * Refuses a move of the project from `from` to `to`: a Space a Host keeps
 * changes its projects there, `to` must exist, and the project must be in
 * `from`. The move itself is a Space move (`Engine.moveProjects`).
 */
export const checkProjectMove =
	(ports: CheckProjectMovePorts) =>
	async (request: CheckProjectMove): Promise<void> => {
		const { projectId, from, to } = request;
		if (
			(await ports.directory.hostedElsewhere(from)) ||
			(await ports.directory.hostedElsewhere(to))
		) {
			throw new Refusal("conflict", HOSTED_ELSEWHERE);
		}
		if (!(await ports.knownSpaces.exists(to))) {
			throw new Refusal("not-found", NO_SUCH_SPACE);
		}
		const row = await ports.store.row(projectId);
		if (!row || row.spaceId !== from) {
			throw new Refusal("not-found", PROJECT_NOT_FOUND);
		}
	};
