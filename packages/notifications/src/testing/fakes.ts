import type { LandedFact } from "@nightshift/engine";

import type {
	NotificationChannel,
	NotificationMessage,
	SendResult,
	VapidKeys,
	WebPushSender,
} from "../channels";
// What a push service gets: only the fake reads it, past the barrel.
import type { WebPushPayload, WebPushRequest } from "../channels/web-push";
import type { OpenGateRef, RunEventSource, RunRef } from "../notifier/sources";
import type { PushTarget } from "../targets";

/** What a fake channel got, in order. */
export type ChannelCall =
	| { call: "send"; targetId: string; message: NotificationMessage }
	| { call: "withdraw"; targetId: string; key: string };

export type FakeChannel = NotificationChannel<PushTarget> & {
	calls: ChannelCall[];
	/** The messages sent, in order. */
	sent(): NotificationMessage[];
	/** The keys withdrawn, in order. */
	withdrawn(): string[];
	/** From now on, a send to this target answers that its service lost it. */
	lose(targetId: string): void;
};

/** A push channel that records each call and reaches nothing. */
export function fakeChannel(): FakeChannel {
	const calls: ChannelCall[] = [];
	const lost = new Set<string>();
	return {
		calls,
		async send(target, message): Promise<SendResult> {
			if (lost.has(target.id)) return "gone";
			calls.push({ call: "send", targetId: target.id, message });
			return "sent";
		},
		async withdraw(target, key) {
			calls.push({ call: "withdraw", targetId: target.id, key });
		},
		sent: () => calls.flatMap((c) => (c.call === "send" ? [c.message] : [])),
		withdrawn: () =>
			calls.flatMap((c) => (c.call === "withdraw" ? [c.key] : [])),
		lose: (targetId) => lost.add(targetId),
	};
}

export type FakeRunEvents = {
	source: RunEventSource;
	/** Sets the open Gates of a Space, as the engine would read them now. */
	setOpen(spaceId: string, gates: OpenGateRef[]): void;
	/** Sets a run, as the engine would read it now. */
	setRun(runId: string, run: RunRef): void;
	/** Lands the facts of run events, as the engine's landed feed would. */
	land(facts: readonly LandedFact[]): void;
};

/** Run events and open Gates that a test sets. */
export function fakeRunEvents(): FakeRunEvents {
	const open = new Map<string, OpenGateRef[]>();
	const runs = new Map<string, RunRef>();
	const listeners = new Set<(facts: readonly LandedFact[]) => void>();
	return {
		source: {
			subscribe(listener) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			openGates: async (spaceId) => [...(open.get(spaceId) ?? [])],
			run: async (_spaceId, runId) => runs.get(runId) ?? null,
		},
		setOpen: (spaceId, gates) => open.set(spaceId, gates),
		setRun: (runId, run) => runs.set(runId, run),
		land(facts) {
			for (const listener of [...listeners]) listener(facts);
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
