import type { ToolLaunchers } from "../../../device";
import type { CliTool } from "../../../settings";
import type { SpaceFlowReader } from "../domain/flow-use";
import type { Asker } from "../domain/secret-users";

/**
 * The driven ports of `flows/config-use`. Another slice or package fills
 * each one: the composition passes it to `wireConfigUse`.
 */

/**
 * This computer's Device: the profiles flows name with its id are this
 * computer's.
 * @filledBy daemon
 */
export type ThisDevice = { readonly id: string };

/**
 * A Space as the Person who asks sees it: its projects, their flows and
 * schedules.
 * @filledBy daemon
 */
export type SpaceViews = { open(at: Asker): SpaceFlowReader };

/**
 * When a CLI tool's login last signed in, on this computer or for a
 * project.
 * @filledBy engine/device
 */
export type ToolSignIns = Pick<ToolLaunchers, "signedInAt">;

/**
 * The secrets a CLI tool's login reads: each `${NAME}` of its variables
 * and of its sign-in input.
 * @filledBy engine/device
 */
export type ToolLogins = {
	references(login: NonNullable<CliTool["login"]>): string[];
};
