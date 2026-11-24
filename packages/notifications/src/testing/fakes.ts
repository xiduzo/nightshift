import type {
	LandedFact,
	ScheduleMissed,
	SevereTurn,
} from "@nightshift/engine";
import type { VapidKeys, WebPushSender } from "../channels";
// What a push service gets: only the fake reads it, past the barrel.
import type { WebPushPayload, WebPushRequest } from "../channels/web-push";
import type { RunEventSource } from "../notifications/notifier";
// The shapes the notifier reads of a run and a Gate: only the fakes set them, past the barrel.
import type { RunRef } from "../notifications/notifier/domain/facts";
import type { OpenGateRef } from "../notifications/notifier/domain/gate-tracker";

export type FakeRunEvents = {
	source: RunEventSource;
	/** Sets the open Gates of a Space, as the engine would read them now. */
	setOpen(spaceId: string, gates: OpenGateRef[]): void;
	/** Sets a run, as the engine would read it now. */
	setRun(runId: string, run: RunRef): void;
	/** Lands the facts of run events, as the engine's landed feed would. */
	land(facts: readonly LandedFact[]): void;
	/** A schedule of the Replica skips a missed cron time, as the engine would say it. */
	miss(missed: ScheduleMissed): void;
	/** The end of this run turns its flow severe, as the watch would read it. Null: it does not. */
	setSevere(runId: string, turn: SevereTurn | null): void;
};

/** Run events and open Gates that a test sets. */
export function fakeRunEvents(): FakeRunEvents {
	const open = new Map<string, OpenGateRef[]>();
	const runs = new Map<string, RunRef>();
	const severe = new Map<string, SevereTurn>();
	const listeners = new Set<(facts: readonly LandedFact[]) => void>();
	const missedListeners = new Set<(missed: ScheduleMissed) => void>();
	return {
		source: {
			subscribe(listener) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			openGates: async (spaceId) => [...(open.get(spaceId) ?? [])],
			run: async (_spaceId, runId) => runs.get(runId) ?? null,
			onScheduleMissed(listener) {
				missedListeners.add(listener);
				return () => missedListeners.delete(listener);
			},
			severeTurn: async (_spaceId, runId) => severe.get(runId) ?? null,
		},
		setOpen: (spaceId, gates) => open.set(spaceId, gates),
		setRun: (runId, run) => runs.set(runId, run),
		land(facts) {
			for (const listener of [...listeners]) listener(facts);
		},
		miss(missed) {
			for (const listener of [...missedListeners]) listener(missed);
		},
		setSevere(runId, turn) {
			if (turn) severe.set(runId, turn);
			else severe.delete(runId);
		},
	};
}

export type FakeWebPushSender = {
	send: WebPushSender;
	/** Each request, in order. */
	requests: WebPushRequest[];
	/** The payload of each request, parsed, in order. */
	payloads(): WebPushPayload[];
	/** From now on, the push service answers this status for the endpoint. */
	answer(endpoint: string, statusCode: number): void;
};

/** A Web Push sender that records each request and answers 201. */
export function fakeWebPushSender(): FakeWebPushSender {
	const requests: WebPushRequest[] = [];
	const answers = new Map<string, number>();
	return {
		requests,
		async send(request) {
			requests.push(request);
			return {
				statusCode: answers.get(request.subscription.endpoint) ?? 201,
			};
		},
		payloads: () =>
			requests.map((r) => JSON.parse(r.payload) as WebPushPayload),
		answer: (endpoint, statusCode) => answers.set(endpoint, statusCode),
	};
}

/** Makes VAPID key pairs that a test can tell apart, and counts them. */
export function fakeVapidKeys(): { generate(): VapidKeys; made: number } {
	const counter = {
		made: 0,
		generate(): VapidKeys {
			counter.made += 1;
			return {
				publicKey: `public-${counter.made}`,
				privateKey: `private-${counter.made}`,
			};
		},
	};
	return counter;
}
