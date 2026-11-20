import type { FlowSources, Schedule } from "@nightshift/flows";
import type { FlowRevision } from "../domain/flow-json";
import type { FlowMergePlan } from "../domain/flow-merge";
import type { FlowSave } from "../domain/flow-save";
import type { OutputType, StepShapes } from "../domain/inferred";
import type { FlowNotice } from "../domain/notices";

/**
 * The flows and the schedules of each Project, in its flow document
 * (ADR 2): every Device has them, with or without a Clone. A call names
 * the Project and asks nothing of it: whether the Project exists is the
 * check of the use case. A write is one change of the document as before:
 * a save is one change of the flows and one of the revisions.
 */
export type FlowStore = {
	/**
	 * Every flow of the project that this Night Shift reads, by name, with
	 * its Flow revision when it is the last one saved. A flow of an older
	 * format reads as the Device that saved it named its profiles and
	 * Devices (`deviceId`: this Device, for a flow that no revision names),
	 * in the Project's Space (`spaceId`).
	 */
	read(
		projectId: string,
		at: { deviceId: string; spaceId: string | undefined },
	): Promise<FlowSources>;
	/**
	 * Saves a flow, a draft with errors too: a new flow when no flow has the
	 * name. A save that changes nothing since the last revision adds none.
	 * Refuses (`conflict`) a flow that a newer Night Shift saved. Returns
	 * every flow as it is stored after the save, with no older format
	 * brought up.
	 */
	save(projectId: string, save: FlowSave): Promise<FlowSources>;
	/** Removes the flow of that name. Its revisions stay. Refuses (`not-found`) a flow that does not exist. */
	remove(projectId: string, name: string): Promise<void>;
	/**
	 * Keeps the shapes of a run's step on its node, marked inferred, with
	 * one revision of kind `infer` by Night Shift. Only while the node has
	 * no schema, on a flow of this format. Returns whether it wrote one.
	 */
	keepShapes(
		projectId: string,
		keep: {
			name: string;
			node: { id: string; type: string };
			shapes: StepShapes;
			deviceId: string;
			at: number;
		},
	): Promise<boolean>;
	/**
	 * Keeps the types a run gave the outputs of a flow, each marked
	 * inferred, with one revision of kind `infer` by Night Shift. Only on an
	 * output that has no type and the template the run read. Returns
	 * whether it wrote one.
	 */
	keepOutputTypes(
		projectId: string,
		keep: {
			name: string;
			types: readonly OutputType[];
			deviceId: string;
			at: number;
		},
	): Promise<boolean>;
	/**
	 * The revisions of the flow of that name, oldest first. Empty for a
	 * flow that does not exist. One of an older format reads as the Device
	 * that saved it named its profiles and Devices, in `spaceId`.
	 */
	revisions(
		projectId: string,
		name: string,
		spaceId: string | undefined,
	): Promise<FlowRevision[]>;
	/** The schedules this Night Shift reads, in their order, and how many others it holds. */
	schedules(
		projectId: string,
	): Promise<{ schedules: Schedule[]; unreadable: number }>;
	/** Saves the schedules: only those that differ. One this Night Shift does not read stays. */
	saveSchedules(
		projectId: string,
		schedules: readonly Schedule[],
	): Promise<void>;
	/** What a person must know about the project's flows, oldest first. */
	notices(projectId: string): Promise<FlowNotice[]>;
	/** Removes a notice. One that is gone already is no error. */
	dismissNotice(projectId: string, noticeId: string): Promise<void>;
	/** Every Project this Replica knows, by id: each has a flow document. */
	projectIds(): Promise<string[]>;
	/**
	 * Brings the flows and the schedules of an older format of the project
	 * to the current one, once: a flow with a revision of kind `upgrade` by
	 * Night Shift on `deviceId`.
	 */
	upgrade(
		projectId: string,
		upgrade: { deviceId: string; spaceId: string; at: number },
	): Promise<void>;
	/** What a merge of the flows of `source` into those of `destination` renames. Changes nothing. */
	planMerge(
		source: string,
		destination: string,
		persons: Readonly<Record<string, string>>,
	): Promise<FlowMergePlan>;
	/** Merges the flows of `source`, their revisions and its schedules into `destination`. Runs again safely. */
	merge(
		source: string,
		destination: string,
		merge: { persons?: Readonly<Record<string, string>>; at: number },
	): Promise<FlowMergePlan>;
};

/**
 * The Space of a Project. Throws (`not-found`) for a Project this Replica
 * does not have, or one that is removed.
 * @filledBy engine/projects
 */
export type ProjectSpaces = {
	spaceOf(projectId: string): Promise<string>;
};

/**
 * This Device: where a save happens.
 * @filledBy engine/wire
 */
export type ThisDevice = {
	id(): Promise<string>;
};

/**
 * The clock of a revision.
 * @filledBy engine/wire
 */
export type Clock = () => number;
