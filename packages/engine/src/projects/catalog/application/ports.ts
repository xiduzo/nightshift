import type { Permissions } from "@nightshift/auth";
import type { Actor, Relay } from "../../../contract";
import type { RunStatus } from "../../../run-status";

/**
 * The driven ports of a person's requests about the Projects, beside the
 * shared ones of `keep`. Another vertical fills each (`@filledBy`): the
 * engine's composition passes it to `wireCatalog`.
 */

/**
 * The Host that keeps a Space: a Project or a Clone of such a Space is
 * added through it.
 * @filledBy devices/relay
 */
export type HostRelay = Pick<
	Relay,
	"addClone" | "addProject" | "addWithoutFolder"
>;

/**
 * The runs of a Project on this computer.
 * @filledBy engine/wire
 */
export type ProjectRuns = {
	/** The ids of the project's runs. */
	runIds(projectId: string): Promise<string[]>;
	/** Whether the run runs a step on this computer now. */
	isActive(runId: string): boolean;
	/** The run's status, as its log says. */
	status(runId: string): Promise<RunStatus>;
};

/**
 * The import of the flows of a folder from before ADR 2.
 * @filledBy engine/flows
 */
export type CloneImports = {
	/** Imports the flows of this Device's Clone of the project, once. Never throws. */
	importClone(projectId: string): Promise<void>;
};

/**
 * Who may act in a Space: the one check of a request a person makes.
 * @filledBy engine/runs
 */
export type ProjectAccess = {
	/**
	 * Refuses an actor who may not act in the Space: a Person who is not a
	 * Member of it (`SpaceNotFound`), or whose role does not allow `need`
	 * (`RoleRefusal`). Without `need`, a Member may. Night Shift itself
	 * may act in every Space.
	 */
	openSpace(
		actor: Actor,
		request: { spaceId: string; need?: Permissions },
	): Promise<void>;
};
