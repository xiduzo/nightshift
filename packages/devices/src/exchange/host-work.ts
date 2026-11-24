import type { Caller } from "../contract";
import { forbidden, type HostExchangeDeps, STARTS_RUNS } from "./host-deps";
import type { HostExchange } from "./types";

/**
 * The work relay (`devices`): a placed Device takes the calls of the runs
 * this Host walks on it, and a Walker calls another of its Person's
 * Devices through this Host.
 */
export function hostWork(
	deps: Pick<HostExchangeDeps, "engine" | "registry" | "selfId" | "work">,
): Pick<HostExchange, "work" | "workReply" | "call" | "stop" | "reachable"> {
	const { engine, registry } = deps;
	/**
	 * The stops of the calls Walkers make through this Host with a
	 * `stopId`, by the Walker's Device and that id, while the call is open.
	 */
	const stops = new Map<string, AbortController>();
	const stopKey = (caller: Caller, id: string) =>
		JSON.stringify([caller.deviceId, id]);

	return {
		async *work(caller, input, signal) {
			yield* deps.work.take(
				caller.deviceId,
				signal ?? new AbortController().signal,
				input.running,
			);
		},

		async workReply(caller, input) {
			return { known: deps.work.reply(caller.deviceId, input) };
		},

		async *call(caller, { deviceId, request, stopId }, signal) {
			// Known before its first wait: a stop right after the start finds it.
			const key = stopId === undefined ? null : stopKey(caller, stopId);
			const stop = new AbortController();
			if (key) stops.set(key, stop);
			try {
				// The Walker asks in the name of its run's Person: its own.
				if (request.personId !== caller.personId) {
					forbidden("A device may ask only for its own Person's runs.");
				}
				await caller.may(request.spaceId, STARTS_RUNS);
				if (deviceId === deps.selfId) {
					// Its owner's run, or another Person's through its Offers. A
					// stop ends the session here, and the stream after its cleanup.
					const ended = signal ?? new AbortController().signal;
					yield* engine.admission.serve(
						request,
						{ keptHere: true },
						key ? AbortSignal.any([ended, stop.signal]) : ended,
					);
					return;
				}
				const paired = await registry.get(deviceId);
				if (
					!paired ||
					paired.revokedAt ||
					(paired.ownerId !== caller.personId &&
						!(await offersInto(deviceId, request.spaceId)))
				) {
					yield {
						kind: "error",
						message:
							"That device is not one of yours on this Host, and it offers nothing to this Space.",
					};
					return;
				}
				// Another Person's Device checks its Offers again itself.
				yield* deps.work.call(
					deviceId,
					request,
					signal,
					key ? stop.signal : undefined,
				);
			} finally {
				if (key && stops.get(key) === stop) stops.delete(key);
			}
		},

		async stop(caller, { id }) {
			const stop = stops.get(stopKey(caller, id));
			stop?.abort();
			return { known: stop !== undefined };
		},

		async reachable(caller, { deviceId }) {
			if (deviceId === deps.selfId) return true;
			const paired = await registry.get(deviceId);
			if (!paired || paired.revokedAt) return false;
			if (paired.ownerId !== caller.personId) {
				// Another Person's: only one that offers to a Space of theirs.
				let offering = false;
				for (const space of await caller.spaces()) {
					if (await offersInto(deviceId, space)) offering = true;
				}
				if (!offering) return false;
			}
			return deps.work.online(deviceId, "");
		},
	};

	/** Whether a Device offers profiles to a Space (its document says so). */
	async function offersInto(deviceId: string, spaceId: string) {
		return (await engine.offers.list(spaceId)).some(
			(o) => o.deviceId === deviceId,
		);
	}
}
