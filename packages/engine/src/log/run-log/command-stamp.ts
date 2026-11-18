import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A Command a Walker applies, as a fact of its run's log: the first event
 * the Command writes to its run carries the Command's id in its payload
 * (`commandId`). So the log says which Commands this Replica applied, also
 * after a restart, and a Command that comes again is not applied twice.
 *
 * The id reaches the event through the call chain of the action
 * (`asCommand`), not through each action's arguments: an answer's
 * `StepEnded`, a signal's `WaitEnded`, a stop's `StopRequested` and a
 * move's `WalkerMoved` are written deep in the runner. A write of another
 * run, or of a drive that was not started by the Command, gets nothing.
 * A Command that writes nothing (refused, or with nothing to do) leaves
 * no trace, and applying it again writes nothing again.
 */

type Applying = { commandId: string; runId: string; stamped: boolean };

const applying = new AsyncLocalStorage<Applying>();

/** Runs `fn` as the Command: the first event `fn` appends to the Command's run carries its id. */
export function asCommand<T>(
	command: { id: string; runId: string },
	fn: () => Promise<T>,
): Promise<T> {
	return applying.run(
		{ commandId: command.id, runId: command.runId, stamped: false },
		fn,
	);
}

/**
 * Appends with the Command's id when this is the first event of the
 * Command being applied to its run. An append that fails gives the id
 * back to the next one.
 */
export async function stampedAppend<P extends object, R>(
	runId: string | null | undefined,
	payload: P,
	append: (payload: P) => Promise<R>,
): Promise<R> {
	const command = applying.getStore();
	if (!command || command.stamped || !runId || command.runId !== runId) {
		return append(payload);
	}
	command.stamped = true;
	try {
		return await append({ ...payload, commandId: command.commandId });
	} catch (error) {
		command.stamped = false;
		throw error;
	}
}
