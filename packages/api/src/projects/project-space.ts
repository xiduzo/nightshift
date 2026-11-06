import { PROJECT_NOT_FOUND } from "@nightshift/engine/projects";
import { Refusal } from "@nightshift/refusal";
import type { z } from "zod";

import { protectedProcedure } from "../procedures";

/**
 * A project of the session's Space, for the Person who asks. A project id
 * names one project on this computer, in one Space. The Space view refuses
 * a project of another Space itself. The services beside it (a project's
 * secrets, its knowledge) take the project as this pair, so a procedure
 * that calls them checks the project first, here, once.
 */

/** A project in its Space, as the services beside the engine take it. */
export type ProjectAt = { spaceId: string; projectId: string };

/**
 * The project in the session's Space, or the refusal: a project the Space
 * does not have is "not found", with the engine's own words for one.
 */
export async function projectIn(
	context: {
		spaceId: string;
		space: { listProjects(): Promise<{ id: string }[]> };
	},
	projectId: string,
): Promise<ProjectAt> {
	const projects = await context.space.listProjects();
	if (!projects.some((project) => project.id === projectId)) {
		throw new Refusal("not-found", PROJECT_NOT_FOUND);
	}
	return { spaceId: context.spaceId, projectId };
}

/**
 * A procedure keyed by the project id of its `input`, in the session's
 * Space, on `base`: the session in its Space, or one that checks a role
 * or the owner first (`permitted(…)`, `ownerProcedure`), so a refused
 * call reads nothing. Its handler gets `project`: the project in its
 * Space, checked.
 */
export function projectProcedure<
	TInput extends z.ZodType<{ projectId: string }>,
>(input: TInput, base: typeof protectedProcedure = protectedProcedure) {
	return base
		.input(input)
		.use(async ({ context, next }, { projectId }) =>
			next({ context: { project: await projectIn(context, projectId) } }),
		);
}
