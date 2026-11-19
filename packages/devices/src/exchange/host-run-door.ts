import { ROLE_REFUSAL, RoleRefusal } from "@nightshift/auth";
import {
	type Engine,
	type OwnDevice,
	type PersonActor,
	permissionOf,
	type RunCommandInput,
	type RunSummary,
	SpaceNotFound,
	type StartRunInput,
} from "@nightshift/engine";
import { PROJECT_NOT_FOUND } from "@nightshift/engine/projects";
import { Refusal } from "@nightshift/refusal";
import { ORPCError } from "@orpc/server";
import type { Caller } from "../contract";

/** A Command a Device sends for a run, with the run's id. */
type Command = RunCommandInput & { runId: string };

/**
 * The Host's door to the engine's run use cases (`Engine.runs`): a call
 * with a Device key acts in the name of the key's Person, through the
 * door `device-key`. The engine finds the run, or the Space, and decides
 * what the Person's role there allows. This says its refusals in the
 * codes a Device of any version knows:
 * - A role that does not allow it: FORBIDDEN, with the role refusal's
 *   words, as `Caller.may` refuses.
 * - A run the Person may not see: the engine's `not-found` (`RunNotFound`,
 *   the words of `RUN_NOT_FOUND`), a BAD_REQUEST with its kind
 *   (`readable` of `host/keyed-call.ts`).
 * - A start in a Space the Person is not a Member of: FORBIDDEN too, as
 *   `Caller.may` refuses a Person who is not a Member.
 * - The Devices of a project in such a Space: the project's not-found
 *   (`PROJECT_NOT_FOUND`), a BAD_REQUEST with its kind.
 */
export function hostRunDoor(engine: Pick<Engine, "runs" | "space">) {
	const actorOf = (caller: Caller): PersonActor => ({
		personId: caller.personId,
		door: "device-key",
	});

	/** The work, with the refusals `refused` names in the Device's codes. */
	async function asCaller<T>(
		work: () => Promise<T>,
		refused: (error: unknown) => boolean,
	): Promise<T> {
		try {
			return await work();
		} catch (error) {
			if (refused(error)) {
				throw new ORPCError("FORBIDDEN", { message: ROLE_REFUSAL.message });
			}
			throw error;
		}
	}
	const byRole = (error: unknown) => error instanceof RoleRefusal;
	const byRoleOrSpace = (error: unknown) =>
		byRole(error) || error instanceof SpaceNotFound;

	return {
		actorOf,
		/** Opens the run of a Command for the Caller's Person: their role must allow the Command. */
		open: async (caller: Caller, command: Command): Promise<void> => {
			await asCaller(
				() =>
					engine.runs.open(actorOf(caller), {
						runId: command.runId,
						need: permissionOf(command.kind),
					}),
				byRole,
			);
		},
		/** Applies a Command to a run this Host walks, as the Caller's Person. */
		act: (caller: Caller, spaceId: string, command: Command): Promise<void> =>
			asCaller(
				() =>
					engine.runs.act(actorOf(caller), {
						runId: command.runId,
						spaceId,
						action: command,
					}),
				byRole,
			),
		/** Starts a run for the Caller's Person, who must be allowed to start runs. */
		start: (
			caller: Caller,
			input: StartRunInput & { spaceId: string },
		): Promise<RunSummary> =>
			asCaller(() => engine.runs.start(actorOf(caller), input), byRoleOrSpace),
		/**
		 * The Caller's Person's Devices for a project. A Space they are not a
		 * Member of has no such project for them: `PROJECT_NOT_FOUND`.
		 */
		async devices(
			caller: Caller,
			input: { spaceId: string; projectId: string },
		): Promise<OwnDevice[]> {
			try {
				return await engine
					.space(input.spaceId, actorOf(caller))
					.listDevices(input.projectId);
			} catch (error) {
				if (error instanceof SpaceNotFound) {
					throw new Refusal("not-found", PROJECT_NOT_FOUND);
				}
				throw error;
			}
		},
	};
}
