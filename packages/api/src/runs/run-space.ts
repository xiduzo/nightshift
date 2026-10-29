import {
	type AccessRefusal,
	type Permissions,
	type RequestAccess,
	ROLE_REFUSAL,
	roleAllows,
	type SpaceAccess,
	spaceAccess,
} from "@nightshift/auth";
import type { Engine } from "@nightshift/engine";
import type { z } from "zod";

import { protectedProcedure } from "../procedures";

/**
 * The run's own Space, for the Person who asks. A run id names one run on
 * this computer, whatever Space the session works in. So every procedure
 * keyed by a run id (a read, the stream, an action) finds the run's Space,
 * checks the Person's role there and goes through that Space's view. The
 * session's active Space stays as it is. Lists stay in the active Space.
 */

/**
 * What finds the run's Space and the Person's role in it: the role from
 * the memberships the request read already (`RequestAccess.roleIn`).
 */
type RunSpaceDeps = {
	engine: Pick<Engine, "spaceOfRun">;
	access: Pick<RequestAccess, "roleIn">;
};

/**
 * Where a run is for the Person, or why they may not have it:
 * - `not-found`: no run of that id, or the Person has no role in its
 *   Space. One answer for both, so it does not tell that the run exists.
 * - `forbidden`: their role in the run's Space does not allow `permissions`.
 */
type RunSpace = { spaceId: string } | { refused: "not-found" | "forbidden" };

/** The Space of the run for the Person, with their role there checked against `permissions`. */
async function runSpaceFor(
	deps: RunSpaceDeps,
	runId: string,
	permissions?: Permissions,
): Promise<RunSpace> {
	const spaceId = await deps.engine.spaceOfRun(runId);
	const role = spaceId ? await deps.access.roleIn(spaceId) : null;
	if (!spaceId || !role) return { refused: "not-found" };
	if (permissions && !roleAllows(role, permissions)) {
		return { refused: "forbidden" };
	}
	return { spaceId };
}

/**
 * Why a procedure keyed by a run id refuses. Each is declared, so a screen
 * reads its code, never its message.
 */
export const runRefusals = {
	NOT_FOUND: { status: 404, message: "This run is not in one of your Spaces." },
	FORBIDDEN: { status: ROLE_REFUSAL.status, message: ROLE_REFUSAL.message },
} as const;

/** A run the Person may not see. */
const RUN_NOT_FOUND: AccessRefusal = {
	allowed: false,
	code: "NOT_FOUND",
	...runRefusals.NOT_FOUND,
};

/**
 * The whole access ladder of a request keyed by a run id, outside a
 * procedure (the daemon's run file routes): a session in a Space that the
 * Host lets in (`spaceAccess`), then the run's own Space with the Person's
 * role there checked against `permissions`. It answers with the run's
 * Space, or the refusal a procedure gives in the same case.
 */
export async function runAccess(
	deps: { access: RequestAccess; engine: Pick<Engine, "spaceOfRun"> },
	runId: string,
	permissions?: Permissions,
): Promise<SpaceAccess> {
	const access = spaceAccess(deps.access);
	if (!access.allowed) return access;
	const found = await runSpaceFor(deps, runId, permissions);
	if ("refused" in found) {
		return found.refused === "forbidden" ? ROLE_REFUSAL : RUN_NOT_FOUND;
	}
	return { ...access, spaceId: found.spaceId };
}

/**
 * A procedure keyed by the run id of its `input`. Its handler gets `space`
 * and `spaceId` of the run's own Space, after the Person's role there
 * allows `permissions`. A run they may not see is "not found".
 */
export function runProcedure<TInput extends z.ZodType<{ runId: string }>>(
	input: TInput,
	permissions?: Permissions,
) {
	return protectedProcedure
		.errors(runRefusals)
		.input(input)
		.use(async ({ context, next, errors }, { runId }) => {
			const found = await runSpaceFor(context, runId, permissions);
			if ("refused" in found) {
				throw found.refused === "forbidden"
					? errors.FORBIDDEN()
					: errors.NOT_FOUND();
			}
			return next({
				context: {
					spaceId: found.spaceId,
					space: context.engine.space(found.spaceId, {
						personId: context.session.user.id,
					}),
				},
			});
		});
}
