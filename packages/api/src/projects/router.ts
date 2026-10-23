import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure, permitted, protectedProcedure } from "../procedures";
import {
	branchesSchema,
	gitInstallSchema,
	projectReadinessSchema,
	projectSchema,
	runCopiesSchema,
} from "./schemas";

export const projects = {
	list: protectedProcedure
		.route({
			summary:
				"Lists the projects of the Space, with the Devices that have a Clone of each.",
		})
		.output(output(z.array(projectSchema)))
		.handler(({ context }) => context.space.listProjects()),
	add: permitted({ project: ["add"] })
		.route({
			summary:
				"Adds a git repository on this computer as a project of the Space.",
		})
		.output(output(projectSchema))
		.input(
			z.object({
				repoPath: z.string().min(1),
				name: z.string().min(1).optional(),
			}),
		)
		.handler(({ context, input }) => context.space.addProject(input)),
	/** The local and remote branches of the clone, for "Start from". Read-only, no fetch. */
	branches: protectedProcedure
		.route({
			summary: "Lists the local and remote branches of a project's clone.",
		})
		.output(output(branchesSchema))
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.listBranches(input.projectId),
		),
	/**
	 * The runs with a worktree or branches left in the project's clone on
	 * this computer: merged, pushed, or with work only here. The owner's:
	 * it is this computer's disk. Read-only, no fetch.
	 */
	runCopies: ownerProcedure
		.route({
			summary:
				"Lists the runs of a project with a worktree or branches left on this computer.",
		})
		.output(output(runCopiesSchema))
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.listRunCopies(input.projectId),
		),
	/** Removes a run's worktree on this computer. With changes, only with `force`. */
	removeRunCopy: ownerProcedure
		.route({
			summary:
				"Removes the worktree of an ended run on this computer. Its branches stay.",
		})
		.output(output(z.void()))
		.input(z.object({ runId: z.string(), force: z.boolean().optional() }))
		.handler(({ context, input }) =>
			context.space.removeRunCopy(input.runId, { force: input.force }),
		),
	/** Deletes a run's local branches, never a remote one. Unsaved commits only with `force`. */
	deleteRunBranches: ownerProcedure
		.route({
			summary:
				"Deletes the local branches of an ended run on this computer. Branches on origin stay.",
		})
		.output(output(z.void()))
		.input(z.object({ runId: z.string(), force: z.boolean().optional() }))
		.handler(({ context, input }) =>
			context.space.deleteRunBranches(input.runId, { force: input.force }),
		),
	/** What the folder needs before runs can start in it. Read-only. */
	check: ownerProcedure
		.route({
			summary: "Checks what a folder needs before runs can start in it.",
		})
		.output(output(projectReadinessSchema))
		.input(z.object({ path: z.string().min(1) }))
		.handler(({ context, input }) => context.projectSetup.check(input.path)),
	/**
	 * The `set-up-git` fix: a repository, a starter `.gitignore` and a first
	 * commit. A name and email go into the repository's own git config.
	 */
	setUpGit: ownerProcedure
		.route({ summary: "Makes a folder a git repository with a first commit." })
		.output(output(projectReadinessSchema))
		.input(
			z.object({
				path: z.string().min(1),
				name: z.string().trim().min(1).optional(),
				email: z.email().optional(),
			}),
		)
		.handler(({ context, input }) => context.projectSetup.setUpGit(input)),
	/** The `install-git` fix: starts the system's installer, or says what to run. */
	installGit: ownerProcedure
		.route({
			summary:
				"Starts the git installer of this computer, or says what to run.",
		})
		.output(output(gitInstallSchema))
		.handler(({ context }) => context.projectSetup.installGit()),
	/** Opens the native folder picker on this Mac. Null when cancelled. */
	chooseFolder: ownerProcedure
		.route({
			summary:
				"Opens the folder picker on this computer and returns the chosen folder.",
		})
		.output(output(z.string().nullable()))
		.handler(({ context }) =>
			context.projectSetup.chooseFolder(
				"Choose a project folder to add to Night Shift",
			),
		),
	remove: permitted({ project: ["remove"] })
		.route({
			summary: "Removes a project from the Space. Its runs and history stay.",
		})
		.output(output(z.void()))
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.removeProject(input.projectId),
		),
	/** A new name, for every Member of the Space. Whoever may add projects may rename them. */
	rename: permitted({ project: ["add"] })
		.route({
			summary: "Gives a project a new name for every Member of the Space.",
		})
		.output(output(projectSchema))
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
		.route({
			summary: "Moves a project, its runs and their history to another Space.",
		})
		.output(output(z.void()))
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
