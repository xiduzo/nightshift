import type { SevereTurn } from "@nightshift/engine";
import type {
	InAppTarget,
	NotificationMessage,
	PushKind,
	PushTarget,
	SendResult,
} from "../../../channels";
import type {
	Claim,
	Delivery,
	DeliveryChange,
	DeliveryStatus,
	NoticeKind,
} from "../../../deliveries";
import type { NotificationSettings } from "../../settings";
import type { RunRef } from "../domain/facts";
import type { OpenGateRef } from "../domain/gate-tracker";

/** The ports of the notifier: what it reads and sends through. */

/**
 * The runs of this Replica, as the notifier reads them.
 * @filledBy engine
 */
export type RunEvents = {
	/** The open Gates of the Space's runs, also those with an answer on its way. */
	openGates(spaceId: string): Promise<OpenGateRef[]>;
	/** One run of the Space. Null: this Replica has no such run. */
	run(spaceId: string, runId: string): Promise<RunRef | null>;
	/**
	 * Whether the end of the run turned its flow severe under Needs a look
	 * (the dashboard's watch). Null: it did not. Absent: never.
	 */
	severeTurn?(spaceId: string, runId: string): Promise<SevereTurn | null>;
};

/**
 * Who may see the runs of a Space: its Members, in every role.
 * @filledBy auth
 */
export type Audience = {
	of(spaceId: string): Promise<string[]>;
};

/**
 * Every Space on this Replica: their open Gates are the baseline.
 * @filledBy auth
 */
export type SpaceList = {
	all(): Promise<string[]>;
};

/**
 * Whether the Person's role in the Space allows an answer to a Gate.
 * @filledBy auth
 */
export type MayAnswer = {
	allows(spaceId: string, personId: string): Promise<boolean>;
};

/**
 * Whether this daemon sends the pushes of the Space (`oneSenderPerSpace`).
 * @filledBy daemon
 */
export type SendsFor = {
	sends(spaceId: string): Promise<boolean>;
};

/**
 * A Person's notification settings, or the defaults.
 * @filledBy notifications/notifications
 */
export type PersonSettings = {
	get(personId: string): Promise<NotificationSettings>;
};

/**
 * The Person's push targets (a phone whose session ended is forgotten),
 * targets by id, and the forget of one.
 * @filledBy notifications/notifications
 */
export type PushTargets = {
	of(personId: string): Promise<PushTarget[]>;
	byIds(ids: readonly string[]): Promise<PushTarget[]>;
	forget(id: string): Promise<void>;
};

/**
 * The open pages and apps of each Person: the in-app stream.
 * @filledBy notifications/channels
 */
export type InApp = {
	send(target: InAppTarget, message: NotificationMessage): Promise<SendResult>;
	withdraw(target: InAppTarget, key: string): Promise<void>;
	/** Tells the open screens that a run changed. Quiet: no push. */
	runChanged(
		target: InAppTarget,
		run: { spaceId: string; runId: string },
	): void;
	/** The Person has a screen open now, or had one a moment ago. */
	isActive(personId: string): boolean;
};

/**
 * The push channels this daemon has, by kind of screen. A kind it has no
 * channel for is absent.
 * @filledBy notifications/wire
 */
export type Pushes = Partial<
	Record<
		PushKind,
		{
			send(
				target: PushTarget,
				message: NotificationMessage,
			): Promise<SendResult>;
			withdraw(target: PushTarget, key: string): Promise<void>;
		}
	>
>;

/**
 * The log of what the notifier did with each event for each Person, keyed
 * by (Person, event key). A key is claimed once, so a notification goes
 * out once, also after a restart or when the same event lands twice.
 */
export type DeliveryLog = {
	/**
	 * Claims the event for the Person: true the first time, false when the
	 * log has it already. A withdrawn entry is claimed anew.
	 */
	claim(
		claim: Claim,
		change: DeliveryChange & { status: DeliveryStatus },
		now: number,
	): Promise<boolean>;
	/** Changes the Person's entry of the key. */
	update(personId: string, key: string, change: DeliveryChange): Promise<void>;
	/** Every Person's entry of the key that can still reach a screen, or did. */
	live(key: string): Promise<Delivery[]>;
	/** The entries of one kind that can still reach a screen, or did. */
	liveOfKind(kind: NoticeKind): Promise<Delivery[]>;
	/** The held entries. */
	held(): Promise<Delivery[]>;
	/** The entries that were claimed and are going out, or that a crash cut short. */
	sending(): Promise<Delivery[]>;
	/** The entries that wait for the end of quiet hours. */
	quiet(): Promise<Delivery[]>;
	/**
	 * Removes the entries made before `before`, except a Gate or a device
	 * wait that can still reach a screen. Returns how many went.
	 */
	prune(before: number): Promise<number>;
};
