import type { PushTarget } from "../../../channels";
import type { Delivery } from "../../../deliveries";
import { inQuietHours } from "../../settings";
import type { GateTracker } from "../domain/gate-tracker";
import {
	keptNotice,
	type NoticeMessage,
	pushMessageOf,
} from "../domain/message";
import {
	duePushes,
	seenOnScreen,
	sendToEach,
	sentHeldEntry,
} from "../domain/pushes";
import type {
	DeliveryLog,
	InApp,
	MayAnswer,
	PersonSettings,
	Pushes,
	PushTargets,
} from "./ports";

export type SendHeldPushesPorts = {
	deliveries: Pick<DeliveryLog, "held" | "sending" | "update">;
	inApp: Pick<InApp, "isActive">;
	settings: PersonSettings;
	targets: Pick<PushTargets, "byIds" | "forget">;
	pushes: Pushes;
	/** What the engine said of each open Gate: its lock-screen mark and options. */
	gates: Pick<GateTracker, "factsOf">;
	mayAnswer: MayAnswer;
	now(): number;
	/** Where a push or a withdraw that did not go out is told. */
	onError(message: string, error: unknown): void;
};

/** The instant of the check. */
export type SendHeldPushes = { at: number };

/**
 * Sends the held pushes that are due: their time came, or their Person
 * has no screen open anymore (the phone app went to the background, the
 * last page closed a minute ago). A push a crash cut short is due too.
 * In quiet hours a due push waits for their end instead.
 */
export const sendHeldPushes =
	(ports: SendHeldPushesPorts) =>
	async ({ at }: SendHeldPushes): Promise<void> => {
		const held = await ports.deliveries.held();
		const sending = await ports.deliveries.sending();
		const due = duePushes(held, sending, at, (personId) =>
			ports.inApp.isActive(personId),
		);
		for (const row of due) {
			const settings = await ports.settings.get(row.personId);
			if (inQuietHours(settings, at)) {
				await ports.deliveries.update(row.personId, row.key, {
					status: "quiet",
				});
				continue;
			}
			// A run's end showed on the open screen: no push after it.
			const seen = seenOnScreen(row.kind, () =>
				ports.inApp.isActive(row.personId),
			);
			const sent = seen
				? []
				: await sendTo(
						ports,
						await ports.targets.byIds(row.heldFor),
						await messageOf(ports, row),
					);
			await ports.deliveries.update(
				row.personId,
				row.key,
				sentHeldEntry(row, sent, at),
			);
		}
	};

/** The message of a held entry, as it went out the first time, read now. */
function messageOf(
	ports: SendHeldPushesPorts,
	row: Delivery,
): Promise<NoticeMessage> {
	return pushMessageOf(
		keptNotice(row),
		ports.now(),
		(spaceId, key) => ports.gates.factsOf(spaceId, key),
		(spaceId, personId) => ports.mayAnswer.allows(spaceId, personId),
	);
}

/** Sends to each target. Returns the ids that got it. */
function sendTo(
	ports: SendHeldPushesPorts,
	targets: PushTarget[],
	message: NoticeMessage,
): Promise<string[]> {
	return sendToEach(
		targets,
		message,
		ports.pushes,
		(id) => ports.targets.forget(id),
		ports.onError,
	);
}
