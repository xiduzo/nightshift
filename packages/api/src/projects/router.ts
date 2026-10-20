import { chooseFolder } from "@nightshift/engine";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { ownerProcedure, permitted, protectedProcedure } from "../procedures";

export const projects = {
	list: protectedProcedure.handler(({ context }) =>
		context.space.listProjects(),
	),
	add: permitted({ project: ["add"] })
		.input(
			z.object({
				repoPath: z.string().min(1),
				name: z.string().min(1).optional(),
			}),
		)
		.handler(({ context, input }) => context.space.addProject(input)),
	/** The local and remote branches of the clone, for "Start from". Read-only, no fetch. */
	branches: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.listBranches(input.projectId),
		),
	/** What the folder needs before runs can start in it. Read-only. */
	check: ownerProcedure
		.input(z.object({ path: z.string().min(1) }))
		.handler(({ context, input }) => context.projectSetup.check(input.path)),
	/**
	 * The `set-up-git` fix: a repository, a starter `.gitignore` and a first
	 * commit. A name and email go into the repository's own git config.
	 */
	setUpGit: ownerProcedure
		.input(
			z.object({
				path: z.string().min(1),
				name: z.string().trim().min(1).optional(),
				email: z.email().optional(),
			}),
		)
		.handler(({ context, input }) => context.projectSetup.setUpGit(input)),
	/** The `install-git` fix: starts the system's installer, or says what to run. */
	installGit: ownerProcedure.handler(({ context }) =>
		context.projectSetup.installGit(),
	),
	/** Opens the native folder picker on this Mac. Null when cancelled. */
	chooseFolder: ownerProcedure.handler(() =>
		chooseFolder("Choose a project folder to add to Night Shift"),
	),
	remove: permitted({ project: ["remove"] })
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.removeProject(input.projectId),
		),
	/** A new name, for every Member of the Space. Whoever may add projects may rename them. */
	rename: permitted({ project: ["add"] })
		.input(
			z.object({
				projectId: z.string(),
				name: z.string().trim().min(1).max(100),
			}),
		)
		.handler(({ context, input }) =>
			context.space.renameProject(input.projectId, input.name),
		),
	/** Moves the project, its runs and their history to another Space: `project.move` in both. */
	move: permitted({ project: ["move"] })
		.input(z.object({ projectId: z.string(), spaceId: z.string().min(1) }))
		.handler(async ({ context, input }) => {
			if (!(await context.can({ project: ["move"] }, input.spaceId))) {
				throw new ORPCError("FORBIDDEN", {
					message: "Your role in that Space does not allow this.",
				});
			}
			await context.space.moveProject(input.projectId, input.spaceId);
		}),
};
