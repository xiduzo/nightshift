import type {
	NotificationChannel,
	NotificationMessage,
	SendResult,
} from "../channels";
import type {
	OpenGateRef,
	RunEvent,
	RunEventSource,
} from "../notifier/sources";
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
	/** Lands run events, as the engine's log would. */
	land(events: readonly RunEvent[]): void;
};

/** Run events and open Gates that a test sets. */
export function fakeRunEvents(): FakeRunEvents {
	const open = new Map<string, OpenGateRef[]>();
	const listeners = new Set<(events: readonly RunEvent[]) => void>();
	return {
		source: {
			subscribe(listener) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			openGates: async (spaceId) => [...(open.get(spaceId) ?? [])],
		},
		setOpen: (spaceId, gates) => open.set(spaceId, gates),
		land(events) {
			for (const listener of [...listeners]) listener(events);
		},
	};
}
