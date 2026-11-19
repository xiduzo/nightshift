import {
	type AccessRefusal,
	type Permissions,
	type RequestAccess,
	ROLE_REFUSAL,
	RoleRefusal,
	type SpaceAccess,
	spaceAccess,
} from "@nightshift/auth";
import {
	type Engine,
	type PersonActor,
	RunNotFound,
	type SpaceEngine,
} from "@nightshift/engine";
import type { z } from "zod";

import { protectedProcedure } from "../procedures";

/**
 * The run's own Space, for the Person who asks. A run id names one run on
 * this computer, whatever Space the session works in. So every procedure
 * keyed by a run id (a read, the stream, an action) goes to the engine's
 * run use cases (`Engine.runs`): each finds the run's Space and checks the
 * Person's role there. The session's active Space stays as it is. Lists
 * stay in the active Space.
 */

/**
 * Why a procedure keyed by a run id refuses. Each is declared, so a screen
 * reads its code, never its message:
 * - `NOT_FOUND`: no run of that id, or the Person has no role in its
 *   Space. One answer for both, so it does not tell that the run exists.
 * - `FORBIDDEN`: their role in the run's Space does not allow the request.
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
 * Host lets in (`spaceAccess`), then the run opened for the session's
 * Person (`Engine.runs.open`), with their role in its Space checked
 * against `permissions`. It answers with the run's Space, or the refusal
 * a procedure gives in the same case.
 */
export async function runAccess(
	deps: { access: RequestAccess; engine: Pick<Engine, "runs"> },
	runId: string,
	permissions?: Permissions,
): Promise<SpaceAccess> {
	const access = spaceAccess(deps.access);
	if (!access.allowed) return access;
	try {
		const { run } = await deps.engine.runs.open(
			{ personId: access.session.user.id, door: "session" },
			{ runId, ...(permissions ? { need: permissions } : {}) },
		);
		return { ...access, spaceId: run.spaceId };
	} catch (error) {
		if (error instanceof RunNotFound) return RUN_NOT_FOUND;
		if (error instanceof RoleRefusal) return ROLE_REFUSAL;
		throw error;
	}
}

/**
 * A procedure keyed by the run id of its `input`. Its handler calls the
 * engine's run use cases with the session's Person (`context.actor`): each
 * opens the run and checks their role in its Space. This says the
 * engine's refusals of who may in the run's words: a run they may not see
 * is "not found", a role that does not allow it is "forbidden".
 */
export function runProcedure<TInput extends z.ZodType<{ runId: string }>>(
	input: TInput,
) {
	return protectedProcedure
		.errors(runRefusals)
		.input(input)
		.use(async ({ next, errors }) => {
			try {
				return await next();
			} catch (error) {
				if (error instanceof RunNotFound) {
					throw errors.NOT_FOUND({ cause: error });
				}
				if (error instanceof RoleRefusal) {
					throw errors.FORBIDDEN({ cause: error });
				}
				throw error;
			}
		});
}

/**
 * The Space view of a run's own Space, for the Person: the run opened for
 * them first (`Engine.runs.open`), with their role checked against
 * `need`. For a request keyed by a run that the run use cases do not
 * hold: the files of a run that other slices keep, the explanation of a
 * run.
 */
export async function runSpaceOf(
	context: { engine: Pick<Engine, "runs" | "space">; actor: PersonActor },
	runId: string,
	need?: Permissions,
): Promise<{ spaceId: string; space: SpaceEngine }> {
	const { run } = await context.engine.runs.open(context.actor, {
		runId,
		...(need ? { need } : {}),
	});
	return {
		spaceId: run.spaceId,
		space: context.engine.space(run.spaceId, context.actor),
	};
}
