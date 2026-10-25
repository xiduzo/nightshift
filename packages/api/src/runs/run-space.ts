import { type Permissions, roleAllows, roleIn } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
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

/** What finds the run's Space and the Person's role in it. */
export type RunSpaceDeps = {
	db: Database;
	engine: Pick<Engine, "spaceOfRun">;
};

/**
 * Where a run is for the Person, or why they may not have it:
 * - `not-found`: no run of that id, or the Person has no role in its
 *   Space. One answer for both, so it does not tell that the run exists.
 * - `forbidden`: their role in the run's Space does not allow `permissions`.
 */
export type RunSpace =
	| { spaceId: string }
	| { refused: "not-found" | "forbidden" };

/** The Space of the run for the Person, with their role there checked against `permissions`. */
export async function runSpaceFor(
	deps: RunSpaceDeps,
	personId: string,
	runId: string,
	permissions?: Permissions,
): Promise<RunSpace> {
	const spaceId = await deps.engine.spaceOfRun(runId);
	const role = spaceId ? await roleIn(deps.db, personId, spaceId) : null;
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
	FORBIDDEN: {
		status: 403,
		message: "Your role in this Space does not allow this.",
	},
} as const;

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
			const personId = context.session.user.id;
			const found = await runSpaceFor(context, personId, runId, permissions);
			if ("refused" in found) {
				throw found.refused === "forbidden"
					? errors.FORBIDDEN()
					: errors.NOT_FOUND();
			}
			return next({
				context: {
					spaceId: found.spaceId,
					space: context.engine.space(found.spaceId, { personId }),
				},
			});
		});
}
