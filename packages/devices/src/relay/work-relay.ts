import { randomUUID } from "node:crypto";
import { HOST_UNREACHABLE } from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import type { WorkRelay } from "../contract";
import type { DeviceLinks, HostSpaces } from "../links";
import type { WorkHub } from "../work";
import { createSpaceRoutes } from "./route";

/** How long the Host may take to take a stop. Then the stream closes: the stop of before. */
const STOP_DEADLINE_MS = 10_000;

/**
 * How this computer's runs reach the Devices their steps are placed on
 * (`createSpaceRoutes`).
 *
 * - A Space this Replica keeps (it is that Space's Host): the hub, which
 *   the placed Devices pull their calls from over their own links.
 * - A Space a Host keeps: the Walker → Host → Device leg. The call goes
 *   to the Host over this computer's link (`devices.call`), which relays it
 *   to the Device, or serves it itself; closing the stream cancels it. The
 *   Host checks the Device is the same Person's.
 * - A Host that cannot be reached: the call answers with one `offline`
 *   error, so the step waits for its Device. The Device is not online.
 *
 * A stop (`stop`) cancels the call on the Device. Through a Host whose
 * hello says `stopWaits`, the call names a `stopId`, the stop goes as
 * `devices.stop`, and the stream goes on until the Device ended the call
 * after its cleanup. Through an older Host, or when the Host does not know
 * the call, closing the stream is the stop, as before.
 */
export function createWorkRelay(deps: {
	hub: Pick<WorkHub, "call" | "online">;
	/** Lazy: the engine is made with this relay. */
	engine(): { hostSpaces: Pick<HostSpaces, "hostOf"> };
	links(): Pick<DeviceLinks, "get">;
}): WorkRelay {
	const { route } = createSpaceRoutes({
		hostOf: (spaceId) => deps.engine().hostSpaces.hostOf(spaceId),
		links: deps.links,
	});

	return {
		stops: true,
		async *call(deviceId, request, signal, stop) {
			const to = await route(request.spaceId);
			if (to.at === "here") {
				yield* deps.hub.call(deviceId, request, signal, stop);
				return;
			}
			if (to.at === "unreachable") {
				yield { kind: "error", message: HOST_UNREACHABLE, offline: true };
				return;
			}
			// A Walker sends calls of runs only. A secret call goes from the
			// Home Host's own hub (`relayMove`), never through `devices.call`.
			const { call } = request;
			if (call.kind === "secret") {
				yield { kind: "error", message: "A run does not move secrets." };
				return;
			}
			const stopId =
				stop && to.hello?.stopWaits === true ? randomUUID() : undefined;
			/** A stop the Host did not take: closing the stream is the stop. */
			const closed = new AbortController();
			/** Ends the stream: `signal`, and a stop through an older Host. */
			const ends = AbortSignal.any([
				closed.signal,
				...(signal ? [signal] : []),
				...(stop && stopId === undefined ? [stop] : []),
			]);
			const onStop = () => {
				if (stopId === undefined) return;
				void to
					.ask(
						(client, late) =>
							client.devices.stop({ id: stopId }, { signal: late }),
						{ deadlineMs: STOP_DEADLINE_MS },
					)
					.then(
						({ known }) => {
							if (!known) closed.abort();
						},
						() => closed.abort(),
					);
			};
			try {
				const replies = await to.client.devices.call(
					{
						deviceId,
						request: { ...request, call },
						...(stopId === undefined ? {} : { stopId }),
					},
					{ signal: ends },
				);
				if (stopId !== undefined) {
					if (stop?.aborted) onStop();
					else stop?.addEventListener("abort", onStop, { once: true });
				}
				for await (const reply of replies) yield reply;
			} catch (error) {
				if (ends.aborted) return;
				// A refusal of the Host keeps its words (the Link's). Anything else
				// is the Host gone quiet: plain words, and the details go to the log.
				if (!(error instanceof Refusal)) {
					console.warn(
						`[devices] the Host ${to.hostId} stopped answering a call:`,
						error,
					);
				}
				yield {
					kind: "error",
					message:
						error instanceof Refusal
							? error.message
							: "The computer that keeps this Space stopped answering.",
					offline: true,
				};
			} finally {
				stop?.removeEventListener("abort", onStop);
			}
		},

		async online(deviceId, spaceId) {
			const to = await route(spaceId);
			if (to.at === "here") return deps.hub.online(deviceId, spaceId);
			if (to.at === "unreachable") return false;
			return to.client.devices.reachable({ deviceId }).catch(() => false);
		},
	};
}
