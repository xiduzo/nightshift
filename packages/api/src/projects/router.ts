import type { ProjectRuns } from "@nightshift/engine";
import { PROJECT_NOT_FOUND } from "@nightshift/engine/projects";
import { Refusal } from "@nightshift/refusal";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { output } from "../output";
import {
	ownerOnly,
	ownerProcedure,
	permitted,
	protectedProcedure,
} from "../procedures";
import { runProcedure } from "../runs";
import {
	branchesSchema,
	gitHubCloneSchema,
	gitHubRepoSchema,
	gitInstallSchema,
	listedProjectSchema,
	projectCopySchema,
	projectReadinessSchema,
	projectSchema,
	projectSourcesSchema,
	runCopiesSchema,
} from "./schemas";

/** How the runs of a project without runs stand. */
const NO_RUNS: ProjectRuns = {
	total: 0,
	statuses: {},
	last: null,
	nextWakeAt: null,
};

export const projects = {
	list: protectedProcedure
		.route({
			summary:
				"Lists the projects of the Space, with the Devices that have a Clone of each and how their runs stand.",
		})
		.output(output(z.array(listedProjectSchema)))
		.handler(async ({ context }) => {
			const [projects, runs] = await Promise.all([
				context.space.listProjects(),
				context.space.projectRuns(),
			]);
			return projects.map((project) => ({
				...project,
				runs: runs.get(project.id) ?? NO_RUNS,
			}));
		}),
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
	removeRunCopy: runProcedure(
		z.object({ runId: z.string(), force: z.boolean().optional() }),
	)
		.use(ownerOnly)
		.route({
			summary:
				"Removes the worktree of an ended run on this computer. Its branches stay.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.space.removeRunCopy(input.runId, { force: input.force }),
		),
	/** Deletes a run's local branches, never a remote one. Unsaved commits only with `force`. */
	deleteRunBranches: runProcedure(
		z.object({ runId: z.string(), force: z.boolean().optional() }),
	)
		.use(ownerOnly)
		.route({
			summary:
				"Deletes the local branches of an ended run on this computer. Branches on origin stay.",
		})
		.output(output(z.void()))
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
	/** Opens the native folder picker on this computer (macOS only, see `sources`). Null when cancelled. */
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
	/** How a project can be added on this computer: a folder picker, the GitHub CLI. */
	sources: ownerProcedure
		.route({
			summary:
				"Says how a project can be added on this computer: a folder picker, GitHub.",
		})
		.output(output(projectSourcesSchema))
		.handler(async ({ context }) => ({
			folderPicker: context.projectSetup.folderPicker,
			gitHub: await context.projectSetup.gitHub.access(),
		})),
	/** The person's GitHub repositories, through the GitHub CLI on this computer. */
	gitHubRepos: ownerProcedure
		.route({
			summary:
				"Lists the GitHub repositories the GitHub CLI on this computer can open.",
		})
		.output(output(z.array(gitHubRepoSchema)))
		.handler(({ context }) => context.projectSetup.gitHub.repos()),
	/**
	 * Starts a clone of a GitHub repository into Night Shift's projects
	 * folder, or uses the clone that is there. Returns at once: poll
	 * `gitHubClone`. Add the folder with `check` and `add` when it is done.
	 */
	cloneFromGitHub: ownerProcedure
		.route({
			summary:
				"Starts to copy a GitHub repository to this computer, for a new project.",
		})
		.output(output(gitHubCloneSchema))
		.input(z.object({ repo: z.string().trim().min(1).max(300) }))
		.handler(({ context, input }) =>
			context.projectSetup.gitHub.start(input.repo),
		),
	/** How the clone of a GitHub repository goes. Null: none started. */
	gitHubClone: ownerProcedure
		.route({
			summary: "Says how copying a GitHub repository to this computer goes.",
		})
		.output(output(gitHubCloneSchema.nullable()))
		.input(z.object({ repo: z.string().trim().min(1).max(300) }))
		.handler(({ context, input }) =>
			context.projectSetup.gitHub.status(input.repo),
		),
	/** The copies of the Space's projects to this computer that run or failed. */
	copies: protectedProcedure
		.route({
			summary:
				"Lists the copies of the Space's projects to this computer that run or failed.",
		})
		.output(output(z.array(projectCopySchema)))
		.handler(async ({ context }) => {
			const ids = new Set(
				(await context.space.listProjects()).map((project) => project.id),
			);
			return context.projectSetup.copies
				.list()
				.filter((copy) => ids.has(copy.projectId));
		}),
	/**
	 * Copies a project of the Space to this computer from GitHub, and adds
	 * it as its Clone here. The owner's: it is this computer's disk. Returns
	 * at once: poll `copies`.
	 */
	copyHere: ownerProcedure
		.route({
			summary:
				"Starts to copy a project from GitHub to this computer, as its Clone here.",
		})
		.output(output(z.void()))
		.input(z.object({ projectId: z.string() }))
		.handler(async ({ context, input }) => {
			const projects = await context.space.listProjects();
			if (!projects.some((project) => project.id === input.projectId)) {
				throw new Refusal("not-found", PROJECT_NOT_FOUND);
			}
			// Not awaited: a copy may take minutes. `copies` says how it goes.
			void context.projectSetup.copies
				.copy(context.space, input.projectId)
				.catch(() => null);
		}),
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
			if (!(await context.access.can({ project: ["move"] }, input.spaceId))) {
				throw new ORPCError("FORBIDDEN", {
					message: "Your role in that Space does not allow this.",
				});
			}
			await context.space.moveProject(input.projectId, input.spaceId);
		}),
};
