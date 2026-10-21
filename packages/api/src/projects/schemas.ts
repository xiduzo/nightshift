import type {
	Branches,
	GitInstall,
	Project,
	ProjectReadiness,
} from "@nightshift/engine";
import { z } from "zod";

import { exact } from "../output";

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
				id: z.enum(["git", "folder", "commit", "identity"]),
				status: z.enum(["ok", "failed", "skipped"]),
				problem: z.string().nullable(),
				fix: z.enum(["install-git", "use-top-folder", "set-up-git"]).nullable(),
			}),
		),
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
