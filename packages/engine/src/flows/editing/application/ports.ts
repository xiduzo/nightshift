import type { MemoryFlow, NodeMemory as Remembered } from "../../../memory";
import type { UsageMoment } from "../../../usage";
import type { KeptFlow, KeptValue } from "../../../variables";

/**
 * The projects of a Space, for the one check of every verb.
 * @filledBy engine/wire
 */
export type SpaceProjects = {
	/**
	 * Waits for the engine to be ready, then refuses (`not-found`) a project
	 * that is not in the Space: the same answer as one that does not exist.
	 */
	inSpace(projectId: string, spaceId: string): Promise<void>;
};

/**
 * The names of Persons and of Devices, by id. One without a name is
 * missing.
 * @filledBy engine/wire
 */
export type Names = {
	persons(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
	devices(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
};

/**
 * The kept variables of a project's flows on this computer.
 * @filledBy engine/variables
 */
export type KeptValues = {
	list(flow: KeptFlow): Promise<KeptValue[]>;
	reset(flow: KeptFlow, name: string): Promise<void>;
};

/**
 * What the Since last run nodes of a project's flows saw, on this computer.
 * @filledBy engine/memory
 */
export type NodeMemory = {
	list(flow: MemoryFlow): Promise<Remembered[]>;
	forget(flow: MemoryFlow, node: string, scope?: string): Promise<void>;
};

/**
 * Anonymous usage, when this computer records it.
 * @filledBy engine/usage
 */
export type FlowUsage = {
	note(moment: UsageMoment): void;
};
