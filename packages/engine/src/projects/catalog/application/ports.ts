import type { Relay } from "../../../contract";
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
