import type { SevereTurn } from "@nightshift/engine";
import type {
	InAppTarget,
	NotificationMessage,
	PushKind,
	PushTarget,
	SendResult,
} from "../../../../channels";
import type {
	NotificationSettings,
	NotificationSettingsPatch,
} from "../../../settings";
import type {
	Audience,
	InApp,
	MayAnswer,
	PersonSettings,
	Pushes,
	PushTargets,
	RunEvents,
	SendsFor,
	SpaceList,
} from "../../application/ports";
import type { RunRef } from "../../domain/facts";
import type { OpenGateRef } from "../../domain/gate-tracker";

/**
 * The in-memory adapters of the ports that others fill (the engine's runs,
 * auth's Members and roles, the daemon's one sender per Space, the
 * settings and targets of a Person, the channels)).
 * Test code: production code never imports this file.
 */

/** The runs of a test: open Gates, runs and severe turns it sets. */
export function inMemoryRunEvents() {
	const open = new Map<string, OpenGateRef[]>();
	const runs = new Map<string, RunRef>();
	const severe = new Map<string, SevereTurn>();
	return {
		/** Sets the open Gates of a Space, as the engine would read them now. */
		setOpen: (spaceId: string, gates: OpenGateRef[]) =>
			open.set(spaceId, gates),
		/** Sets a run, as the engine would read it now. */
		setRun: (runId: string, run: RunRef) => runs.set(runId, run),
		/** The end of this run turns its flow severe. Null: it does not. */
		setSevere(runId: string, turn: SevereTurn | null) {
			if (turn) severe.set(runId, turn);
			else severe.delete(runId);
		},
		openGates: async (spaceId: string) => [...(open.get(spaceId) ?? [])],
		run: async (_spaceId: string, runId: string) => runs.get(runId) ?? null,
		severeTurn: async (_spaceId: string, runId: string) =>
			severe.get(runId) ?? null,
	} satisfies RunEvents & Record<string, unknown>;
}

/** The Members of each Space of a test, by Space. */
export function inMemoryAudience(members: Record<string, string[]>) {
	return {
		members,
		of: async (spaceId: string) => [...(members[spaceId] ?? [])],
	} satisfies Audience & Record<string, unknown>;
}

/** Every Space of a test: the Spaces of its Members. */
export function inMemorySpaceList(members: Record<string, string[]>) {
	return {
		all: async () => Object.keys(members),
	} satisfies SpaceList;
}

/** Who may answer a Gate, as `${spaceId}:${personId}`, and who was asked. */
export function inMemoryMayAnswer() {
	const answerers = new Set<string>();
	const asked: string[] = [];
	return {
		answerers,
		asked,
		async allows(spaceId: string, personId: string) {
			asked.push(`${spaceId}:${personId}`);
			return answerers.has(`${spaceId}:${personId}`);
		},
	} satisfies MayAnswer & Record<string, unknown>;
}

/** The Spaces this daemon sends for. */
export function inMemorySendsFor() {
	const senders = new Set<string>();
	return {
		senders,
		sends: async (spaceId: string) => senders.has(spaceId),
	} satisfies SendsFor & Record<string, unknown>;
}

/** The settings of a Person without any: what the settings slice gives (`defaultSettings`). */
const DEFAULTS = (timeZone: string): NotificationSettings => ({
	events: {
		gateOpened: true,
		runFinished: true,
		runFailed: true,
		deviceWait: true,
	},
	quietHours: null,
	timeZone,
	screens: { web: true, expo: true, desktop: true },
	holdMinutes: 3,
	pushUrgencies: ["now"],
});

/** The settings of each Person, and a save of a patch as the settings slice applies it. */
export function inMemoryPersonSettings(timeZone = "UTC") {
	const saved = new Map<string, NotificationSettings>();
	const read = (personId: string) => saved.get(personId) ?? DEFAULTS(timeZone);
	return {
		get: async (personId: string) => read(personId),
		save(personId: string, patch: NotificationSettingsPatch) {
			const current = read(personId);
			saved.set(personId, {
				events: { ...current.events, ...patch.events },
				quietHours:
					patch.quietHours === undefined
						? current.quietHours
						: patch.quietHours,
				timeZone: patch.timeZone ?? current.timeZone,
				screens: { ...current.screens, ...patch.screens },
				holdMinutes: patch.holdMinutes ?? current.holdMinutes,
				pushUrgencies: patch.pushUrgencies ?? current.pushUrgencies,
			});
		},
	} satisfies PersonSettings & Record<string, unknown>;
}

/** The push targets of a test, in the order they were added. */
export function inMemoryPushTargets() {
	const targets: PushTarget[] = [];
	const forgotten: string[] = [];
	return {
		/** Every target that was forgotten, by id, in order. */
		forgotten,
		/** A new screen of the Person: `<kind>-<personId>`, or `-2` and on for a second one. */
		add(personId: string, kind: PushKind): PushTarget {
			const base = `${kind}-${personId}`;
			const count = targets.filter((t) => t.id.startsWith(base)).length;
			const target: PushTarget = {
				id: count === 0 ? base : `${base}-${count + 1}`,
				personId,
				kind,
				name: `${personId}'s ${kind}`,
				platform: kind,
				endpoint: `${kind}://${personId}`,
				keys: null,
				sessionId: null,
				createdAt: 0,
				lastSeenAt: null,
			};
			targets.push(target);
			return target;
		},
		of: async (personId: string) =>
			targets.filter((t) => t.personId === personId),
		byIds: async (ids: readonly string[]) =>
			targets.filter((t) => ids.includes(t.id)),
		async forget(id: string) {
			forgotten.push(id);
			const at = targets.findIndex((t) => t.id === id);
			if (at >= 0) targets.splice(at, 1);
		},
	} satisfies PushTargets & Record<string, unknown>;
}

/** What the in-app stream got, per Person, in order. */
export type InAppCall =
	| { call: "send"; message: NotificationMessage }
	| { call: "withdraw"; key: string }
	| { call: "run-changed"; spaceId: string; runId: string };

/** The in-app stream of a test: what each Person's screens got, and who has a screen open. */
export function inMemoryInApp() {
	const calls = new Map<string, InAppCall[]>();
	const record = (target: InAppTarget, call: InAppCall) =>
		calls.set(target.personId, [...(calls.get(target.personId) ?? []), call]);
	const active = new Set<string>();
	return {
		/** What the Person's screens got, in order. */
		of: (personId: string): InAppCall[] => calls.get(personId) ?? [],
		/** The messages the Person's screens got, in order. */
		messages: (personId: string) =>
			(calls.get(personId) ?? []).flatMap((c) =>
				c.call === "send" ? [c.message] : [],
			),
		/** The Person has a screen open now, or not. */
		setActive(personId: string, open: boolean) {
			if (open) active.add(personId);
			else active.delete(personId);
		},
		async send(target: InAppTarget, message: NotificationMessage) {
			record(target, { call: "send", message });
			return "sent" as SendResult;
		},
		async withdraw(target: InAppTarget, key: string) {
			record(target, { call: "withdraw", key });
		},
		runChanged(target: InAppTarget, run: { spaceId: string; runId: string }) {
			record(target, { call: "run-changed", ...run });
		},
		isActive: (personId: string) => active.has(personId),
	} satisfies InApp & Record<string, unknown>;
}

/** What a push channel of a test got, in order. */
export type PushCall =
	| { call: "send"; targetId: string; message: NotificationMessage }
	| { call: "withdraw"; targetId: string; key: string };

/** One push channel of a test: it records each call and reaches nothing. */
export function inMemoryPushChannel() {
	const lost = new Set<string>();
	const failing = new Set<string>();
	const channel = {
		calls: [] as PushCall[],
		/** A send to this target answers that its service lost it. */
		lose: (targetId: string) => lost.add(targetId),
		/** A send or a withdraw to this target throws. */
		fail: (targetId: string) => failing.add(targetId),
		/** Each send, as `<targetId>:<key>`, in order. */
		sentTo: () =>
			channel.calls.flatMap((c) =>
				c.call === "send" ? [`${c.targetId}:${c.message.key}`] : [],
			),
		/** The messages sent, in order. */
		sent: () =>
			channel.calls.flatMap((c) => (c.call === "send" ? [c.message] : [])),
		/** Each withdraw, as `<targetId>:<key>`, in order. */
		withdrawn: () =>
			channel.calls.flatMap((c) =>
				c.call === "withdraw" ? [`${c.targetId}:${c.key}`] : [],
			),
		async send(target: PushTarget, message: NotificationMessage) {
			if (failing.has(target.id)) throw new Error("The service is down.");
			if (lost.has(target.id)) return "gone" as SendResult;
			channel.calls.push({ call: "send", targetId: target.id, message });
			return "sent" as SendResult;
		},
		async withdraw(target: PushTarget, key: string) {
			if (failing.has(target.id)) throw new Error("The service is down.");
			channel.calls.push({ call: "withdraw", targetId: target.id, key });
		},
	};
	return channel;
}

/** A channel for each kind of screen. */
export function inMemoryPushes() {
	return {
		web: inMemoryPushChannel(),
		expo: inMemoryPushChannel(),
		desktop: inMemoryPushChannel(),
	} satisfies Pushes;
}
