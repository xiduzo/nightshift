import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import { runCommand } from "@nightshift/db/schema";
import type {
	RunCommandInput,
	RunCommandKind,
	SpaceEngine,
} from "@nightshift/engine";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { RunCommand } from "../contract";

/**
 * Commands: a person's action on a run that another Device walks. The
 * Walker is the only writer of its run's events, so an answer to a Gate, a
 * signal or a stop travels to it as a command, and the Walker applies it
 * like a local action. The Host keeps a command (`run_command`) until the
 * Walker reports it applied, or why not; a command to a Walker that is
 * offline waits, and shows as pending. The Walker's log says which
 * commands it applied (`RunHistoryExchange.apply`).
 */

/** The permission each kind needs in the run's Space. */
export const COMMAND_PERMISSION = {
	"gate.resolve": { gate: ["resolve"] },
	"signal.send": { signal: ["send"] },
	"run.stop": { run: ["stop"] },
	"run.move": { run: ["move"] },
} as const satisfies Record<RunCommandKind, Record<string, string[]>>;

export type RunCommands = ReturnType<typeof createRunCommands>;

export function createRunCommands(deps: { db: Database }) {
	const { db } = deps;
	const listeners = new Set<() => void>();

	function toCommand(row: typeof runCommand.$inferSelect): RunCommand {
		return {
			id: row.id,
			spaceId: row.spaceId,
			runId: row.runId,
			walkerId: row.walkerId,
			personId: row.personId,
			createdAt: row.createdAt.getTime(),
			kind: row.kind,
			payload: JSON.parse(row.payload),
		} as RunCommand;
	}

	return {
		/** Keeps a command for its Walker, until the Walker reports it done. */
		async enqueue(
			command: RunCommandInput & {
				spaceId: string;
				runId: string;
				walkerId: string;
				personId: string;
			},
		): Promise<RunCommand> {
			const [row] = await db
				.insert(runCommand)
				.values({
					id: randomUUID(),
					spaceId: command.spaceId,
					runId: command.runId,
					walkerId: command.walkerId,
					kind: command.kind,
					payload: JSON.stringify(command.payload),
					personId: command.personId,
				})
				.returning();
			if (!row) throw new Error("Could not keep the command.");
			for (const listener of [...listeners]) listener();
			return toCommand(row);
		},

		/** The Walker's commands that wait, oldest first. */
		async pendingFor(walkerId: string): Promise<RunCommand[]> {
			const rows = await db
				.select()
				.from(runCommand)
				.where(
					and(eq(runCommand.walkerId, walkerId), isNull(runCommand.doneAt)),
				)
				.orderBy(asc(runCommand.createdAt));
			return rows.map(toCommand);
		},

		/** The runs' commands that wait for their Walkers, oldest first, in one read. */
		async pendingOf(runIds: readonly string[]): Promise<RunCommand[]> {
			if (runIds.length === 0) return [];
			const rows = await db
				.select()
				.from(runCommand)
				.where(
					and(
						inArray(runCommand.runId, [...runIds]),
						isNull(runCommand.doneAt),
					),
				)
				.orderBy(asc(runCommand.createdAt));
			return rows.map(toCommand);
		},

		/** The Walker applied the command, or says why it did not. Only its Walker may say so. */
		async done(
			id: string,
			walkerId: string,
			error: string | null,
		): Promise<void> {
			await db
				.update(runCommand)
				.set({ doneAt: new Date(), error })
				.where(and(eq(runCommand.id, id), eq(runCommand.walkerId, walkerId)));
			for (const listener of [...listeners]) listener();
		},

		/** Calls `listener` when a command is kept, or reported done. Returns the unsubscribe. */
		onChanged(listener: () => void): () => void {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

/**
 * Applies a command like the person's own action, through the Space's
 * engine: on the Walker, that writes the run's events.
 */
export async function applyRunCommand(
	space: SpaceEngine,
	command: RunCommandInput & { runId: string },
): Promise<void> {
	switch (command.kind) {
		case "gate.resolve":
			await space.resolveGate({ runId: command.runId, ...command.payload });
			return;
		case "signal.send":
			await space.signalRun(command.runId, command.payload.name);
			return;
		case "run.stop":
			await space.stopRun(
				command.runId,
				command.payload.when ? { when: command.payload.when } : undefined,
			);
			return;
		case "run.move":
			await space.moveRun(command.runId, command.payload.to);
			return;
	}
}
