import { z } from "zod";

/**
 * The merge of a Device's own personal Space into its Person's personal
 * Space on their home Host (ADR 1), as the two talk about it: the
 * Projects the Device has, and where the Host puts each one.
 */

/** A Project of the Device's own personal Space, as it asks its home Host to take it. */
export const personalProjectSchema = z.object({
	id: z.string().regex(/^[\w-]{1,64}$/),
	name: z.string().min(1).max(512),
	/** The normalised remote (`github.com/acme/app`), null without one. */
	remote: z.string().min(1).max(512).nullable(),
	createdAt: z.number().int(),
	removedAt: z.number().int().nullable(),
	/** The Device has a Clone of it. */
	clone: z.boolean(),
});
export type PersonalProject = z.infer<typeof personalProjectSchema>;

export const personalMergeInputSchema = z.object({
	/** The Device's own Person, who becomes the key's Person in the moved rows. */
	personId: z.string().min(1).max(128),
	projects: z.array(personalProjectSchema).max(1_000),
	/**
	 * The Projects (by their id on the Device) whose remote is a Project
	 * of a shared Space here, that the Person chose to move into that
	 * Project. Every other one stays personal.
	 */
	join: z.array(z.string().min(1).max(64)).max(1_000).default([]),
	/** Answers what a merge would do, and changes nothing. */
	dryRun: z.boolean().default(false),
});
export type PersonalMergeInput = z.input<typeof personalMergeInputSchema>;

/**
 * A Project of the Device whose remote is a Project of a shared Space
 * here, a Space the Person is a Member of. It moves into that Project only
 * when the Person chose it (`joined`). Otherwise it is a Project of its
 * own in the personal Space, without the link to that remote here.
 */
export const elsewhereProjectSchema = z.object({
	/** Its id on the Device. */
	projectId: z.string(),
	name: z.string(),
	remote: z.string(),
	spaceId: z.string(),
	spaceName: z.string(),
	/** The Project of that remote here. */
	hostProjectId: z.string(),
	/** It moves into the Project of the shared Space. */
	joined: z.boolean(),
});
export type ElsewhereProject = z.infer<typeof elsewhereProjectSchema>;

/** Where the Host puts the Device's Projects, and its Person's id here. */
export const personalMergeSchema = z.object({
	/** The Person's personal Space here: the Space that stays. */
	spaceId: z.string(),
	/**
	 * Each Project of the Device, by its id there: its id here. Its own
	 * for a Project the Host took as it is, else the Project with its
	 * remote.
	 */
	projectMap: z.record(z.string(), z.string()),
	/** The Device's Person: their id here. */
	personMap: z.record(z.string(), z.string()),
	elsewhere: z.array(elsewhereProjectSchema),
});
export type PersonalMerge = z.infer<typeof personalMergeSchema>;

/** How far a merge of the personal Spaces came. */
export type MergeState = "planned" | "mapped" | "moved" | "pushed";

/** Where a Project of this computer's Personal goes, as the person sees it before the merge. */
export type MergeProjectView = {
	id: string;
	name: string;
	remote: string | null;
	/** A person removed it: it moves, and stays removed. */
	removed: boolean;
	runs: number;
	/**
	 * `new`: a project of its own in Personal. `same-remote`: it joins the
	 * project with its remote in Personal. `shared`: it joins the project
	 * with its remote in a shared Space (only when chosen). `apart`: its
	 * remote is a project of a shared Space, and it stays apart from it.
	 */
	into: "new" | "same-remote" | "shared" | "apart";
	/** The shared Space with its remote, for `shared` and `apart`. */
	sharedSpace: { id: string; name: string } | null;
	/** The flows that take another name, because the project they join has one by that name. */
	renamedFlows: { from: string; to: string }[];
	/** Schedules that name no device: their runs keep running on this computer. */
	schedules: number;
};

/** What a merge of this computer's Personal into its home Host's would do. Changes nothing. */
export type MergePreview = {
	host: { id: string; name: string };
	projects: MergeProjectView[];
	/** How many runs move. */
	runs: number;
};

/** How a merge went. */
export type MergeResult = {
	state: MergeState;
	projects: number;
	runs: number;
	/** The copy of the database made before the merge changed anything. */
	backup: string;
};

/** Whether this computer's Personal waits to merge into its home Host's. */
export type MergePending = {
	/** Personal can merge, or a merge that started waits to go on. */
	pending: boolean;
	/** How far a merge that started came. Null: none started. */
	state: MergeState | null;
	/** The home Host. Null without one. */
	hostName: string | null;
	/** Why it cannot run now. Null: it can. */
	blocked: string | null;
};

/** How far a split of Personal off the home Host's came, when this computer leaves it. */
export type SplitState = "planned" | "moved" | "done";

/** How a split of Personal off the home Host's went. */
export type SplitResult = {
	state: SplitState;
	/** The new personal Space of this computer's own. */
	spaceId: string;
	/** How many projects and runs came along. */
	projects: number;
	runs: number;
	/**
	 * How many schedules of those projects named another Device: they
	 * are paused on this computer, since the Host still fires them there.
	 * Turned on, they fire here.
	 */
	unpinned: number;
	/** The copy of the database made before the split changed anything. */
	backup: string;
};

/** How `nightshift leave` went. */
export type LeaveResult = {
	/** The home Host this computer left. */
	host: { id: string; name: string };
	/**
	 * The Host took the leave: this computer's access there is gone. False:
	 * it did not answer, so it still lists this computer until its owner
	 * removes it there.
	 */
	told: boolean;
	/** The split of Personal off the Host's. Null: Personal was this computer's own. */
	split: SplitResult | null;
	/** Why the split waits. Null: it is done, or there was nothing to split. */
	waiting: string | null;
};
