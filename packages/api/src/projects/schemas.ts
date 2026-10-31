import type { ProjectRuns, RunCopies } from "@nightshift/engine";
import type {
	Branches,
	GitHubAccess,
	GitHubClone,
	GitHubRepo,
	GitInstall,
	Project,
	ProjectCopy,
	ProjectReadiness,
} from "@nightshift/engine/projects";
import { z } from "zod";

import { exact } from "../output";
import { runStatusSchema } from "../runs";

/** A project of the Space, and the Devices with a Clone of it. */
export const projectSchema = exact<Project>()(
	z.object({
		id: z.string(),
		name: z.string(),
		/** The folder of its Clone on this computer. Null: it is not on this computer. */
		repoPath: z.string().nullable(),
		/** The normalised `origin`, for example `github.com/acme/app`. */
		remote: z.string().nullable(),
		createdAt: z.number(),
		clones: z.array(
			z.object({
				deviceId: z.string(),
				deviceName: z.string().nullable(),
				thisDevice: z.boolean(),
			}),
		),
	}),
);

/** How the runs of a project stand. */
const projectRunsSchema = exact<ProjectRuns>()(
	z.object({
		total: z.number(),
		statuses: z.partialRecord(runStatusSchema, z.number()),
		last: z
			.object({ id: z.string(), title: z.string(), createdAt: z.number() })
			.nullable(),
		nextWakeAt: z.number().nullable(),
	}),
);

/**
 * A project in the list, with how its runs stand. Older Hosts send no
 * `runs`: a screen then counts the runs it reads.
 */
export const listedProjectSchema = exact<Project & { runs?: ProjectRuns }>()(
	projectSchema.extend({ runs: projectRunsSchema.optional() }),
);

/** The branches of a clone, newest commit first. */
export const branchesSchema = exact<Branches>()(
	z.object({
		current: z.string().nullable(),
		local: z.array(z.string()),
		remote: z.array(z.string()),
	}),
);

/** What a folder needs before runs can start in it, step by step. */
export const projectReadinessSchema = exact<ProjectReadiness>()(
	z.object({
		path: z.string(),
		ready: z.boolean(),
		topLevel: z.string().nullable(),
		needsIdentity: z.boolean(),
		steps: z.array(
			z.object({
				id: z.enum(["git", "folder", "commit", "identity", "tools"]),
				status: z.enum(["ok", "failed", "skipped"]),
				problem: z.string().nullable(),
				fix: z
					.enum([
						"install-git",
						"use-top-folder",
						"set-up-git",
						"install-tools",
					])
					.nullable(),
			}),
		),
		/** How to install the programs of the knowledge sources that are missing. */
		toolsInstall: z
			.union([
				z.object({ kind: z.literal("command"), command: z.string() }),
				z.object({ kind: z.literal("manual"), url: z.string() }),
			])
			.nullable(),
	}),
);

/** A local branch of a run, and where its commits are kept. */
const runBranchSchema = z.object({
	name: z.string(),
	merged: z.boolean(),
	pushed: z.boolean(),
	ahead: z.number().nullable(),
	unsaved: z.number(),
});

/** The runs of a project with a copy or branches left on this computer. */
export const runCopiesSchema = exact<RunCopies>()(
	z.object({
		defaultBranch: z.string().nullable(),
		copies: z.array(
			z.object({
				runId: z.string(),
				title: z.string(),
				status: runStatusSchema,
				active: z.boolean(),
				createdAt: z.number(),
				endedAt: z.number().nullable(),
				copy: z.boolean(),
				changes: z.number().nullable(),
				branches: z.array(runBranchSchema),
				safe: z.boolean(),
				cleanupAt: z.number().nullable(),
				removed: z
					.object({ at: z.number(), by: z.enum(["person", "cleanup"]) })
					.nullable(),
			}),
		),
	}),
);

/** How a project can be added on this computer. */
export const projectSourcesSchema = exact<{
	folderPicker: boolean;
	gitHub: GitHubAccess;
}>()(
	z.object({
		/** This computer can open a folder picker. */
		folderPicker: z.boolean(),
		/** The GitHub CLI on this computer. */
		gitHub: z.enum(["missing", "signed-out", "signed-in"]),
	}),
);

/** A repository the person can open on GitHub. */
export const gitHubRepoSchema = exact<GitHubRepo>()(
	z.object({
		name: z.string(),
		description: z.string().nullable(),
		private: z.boolean(),
	}),
);

/** How one clone from GitHub goes. */
export const gitHubCloneSchema = exact<GitHubClone>()(
	z.discriminatedUnion("state", [
		z.object({ state: z.literal("cloning"), repo: z.string() }),
		z.object({
			state: z.literal("done"),
			repo: z.string(),
			path: z.string(),
			reused: z.boolean(),
		}),
		z.object({
			state: z.literal("failed"),
			repo: z.string(),
			problem: z.string(),
		}),
	]),
);

/** A copy of a project to this computer that runs or failed. */
export const projectCopySchema = exact<ProjectCopy>()(
	z.object({
		projectId: z.string(),
		state: z.enum(["copying", "failed"]),
		problem: z.string().nullable(),
	}),
);

/** What starting the git installer did. */
export const gitInstallSchema = exact<GitInstall>()(
	z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("started") }),
		z.object({ kind: z.literal("command"), command: z.string() }),
		z.object({ kind: z.literal("manual"), url: z.string() }),
	]),
);
