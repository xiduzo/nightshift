import { RoleRefusal } from "@nightshift/auth";
import {
	type AuthSpaceMembersDeps,
	authSpaceMembers,
} from "./adapters/out/auth-space-members";
import { logRunRecords } from "./adapters/out/log-run-records";
import { openRun } from "./application/open-run";
import { openSpace } from "./application/open-space";

/**
 * The wiring of access: the one place that builds its real adapters (the
 * runs over the run log, the Members over `@nightshift/auth` and the Space
 * documents) and binds each use case to its ports.
 */

/** What the engine gives access: what its real adapters stand on. */
export type AccessDeps = {
	/** The run log: the row of each run, and whether this computer walks it. */
	log: Parameters<typeof logRunRecords>[0];
	members: AuthSpaceMembersDeps;
};

/** The use cases of access, bound to their ports. */
export type Access = {
	/** Opens a run for an actor: the one check of who may see or act on it. */
	openRun: ReturnType<typeof openRun>;
	/** Opens a Space for an actor, for a request keyed by a Space or a project. */
	openSpace: ReturnType<typeof openSpace>;
};

export function wireAccess(deps: AccessDeps): Access {
	const ports = {
		runs: logRunRecords(deps.log),
		members: authSpaceMembers(deps.members),
		RoleRefusal,
	};
	return { openRun: openRun(ports), openSpace: openSpace(ports) };
}
