import type { PushTarget } from "../../channels";
import { waitingKey } from "../../contract";
import type { Delivery } from "../../deliveries";
import { inQuietHours } from "../../settings";
import type { GateTracker } from "../domain/gate-tracker";
import {
	gatesWaitingMessage,
	keptNotice,
	type NoticeMessage,
	pushMessageOf,
} from "../domain/message";
import type { Bundles } from "../domain/notifier-state";
import {
	byPerson,
	heldTargetIds,
	quietEnd,
	quietEndEntry,
	sendToEach,
} from "../domain/pushes";
import type {
	DeliveryLog,
	MayAnswer,
	PersonSettings,
	Pushes,
	PushTargets,
} from "./ports";

export type EndQuietHoursPorts = {
	deliveries: Pick<DeliveryLog, "quiet" | "update">;
	settings: PersonSettings;
	targets: Pick<PushTargets, "byIds" | "forget">;
	bundles: Pick<Bundles, "add">;
	pushes: Pushes;
	/** What the engine said of each open Gate: its lock-screen mark and options. */
	gates: Pick<GateTracker, "factsOf">;
	mayAnswer: MayAnswer;
	now(): number;
	/** Where a push or a withdraw that did not go out is told. */
	onError(message: string, error: unknown): void;
};

/** The instant of the check. */
export type EndQuietHours = { at: number };

/**
 * Sends what quiet hours held, for each Person whose quiet hours are
 * over. Each screen gets one push that says how many of the Gates it held
 * still wait (or the one Gate itself). Runs that ended meanwhile go
 * without a push.
 */
export const endQuietHours =
	(ports: EndQuietHoursPorts) =>
	async ({ at }: EndQuietHours): Promise<void> => {
		for (const [personId, rows] of byPerson(await ports.deliveries.quiet())) {
			const settings = await ports.settings.get(personId);
			if (inQuietHours(settings, at)) continue;
			const { gates, stillWait, dropped } = quietEnd(rows);
			// Runs that ended meanwhile go without a push.
			for (const row of dropped) {
				await ports.deliveries.update(personId, row.key, {
					status: "dropped",
					heldFor: [],
				});
			}
			// Each screen hears of the Gates it held, and only of those: a
			// Space another Host sends for held this computer's own screens.
			const targets = (await ports.targets.byIds(heldTargetIds(gates))).filter(
				(target) => settings.screens[target.kind],
			);
			const sentTo = new Map<string, string[]>();
			for (const target of targets) {
				const waiting = gates.filter((row) => row.heldFor.includes(target.id));
				const [one] = waiting;
				if (waiting.length === 1 && one) {
					// One Gate: the Gate itself, so its answer withdraws it.
					const sent = await sendTo(
						ports,
						[target],
						await messageOf(ports, one),
					);
					sentTo.set(one.key, [...(sentTo.get(one.key) ?? []), ...sent]);
				} else if (waiting.length > 1) {
					const key = waitingKey(at);
					// The screen was told of each Gate: each one's close withdraws it there.
					const sent = await sendTo(
						ports,
						[target],
						gatesWaitingMessage(key, waiting.length, at),
					);
					for (const row of waiting) {
						sentTo.set(row.key, [...(sentTo.get(row.key) ?? []), ...sent]);
					}
					if (sent.length > 0) {
						ports.bundles.add({
							targetId: target.id,
							key,
							gates: new Set(waiting.map((row) => row.key)),
						});
					}
				}
			}
			for (const row of stillWait) {
				const reach = (await ports.targets.byIds(row.heldFor)).filter(
					(target) => settings.screens[target.kind],
				);
				sentTo.set(
					row.key,
					await sendTo(ports, reach, await messageOf(ports, row)),
				);
			}
			for (const row of [...gates, ...stillWait]) {
				const sent = sentTo.get(row.key) ?? [];
				await ports.deliveries.update(
					personId,
					row.key,
					quietEndEntry(sent, at),
				);
			}
		}
	};

/** The message of a held entry, as it went out the first time, read now. */
function messageOf(
	ports: EndQuietHoursPorts,
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
	ports: EndQuietHoursPorts,
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
