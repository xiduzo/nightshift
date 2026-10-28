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
