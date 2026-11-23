import { INBOX_KEEP_MS } from "@nightshift/engine";
import { waitingKey } from "../contract";
import { inQuietHours } from "../settings";
import { gatesWaitingMessage } from "./domain/message";
import {
	byPerson,
	duePushes,
	heldTargetIds,
	quietEnd,
	quietEndEntry,
	seenOnScreen,
	sentHeldEntry,
} from "./domain/pushes";
import type { NotifierParts } from "./parts";
import { close, messageOf, sendTo } from "./telling";

/** What the notifier checks on its timer: the device waits that ended, held pushes, the end of quiet hours, the prune. */

export async function tick(parts: NotifierParts): Promise<void> {
	const at = parts.now();
	await endWaits(parts, at);
	await sendDue(parts, at);
	await endQuietHours(parts, at);
	await prune(parts, at);
}

/**
 * Sends the held pushes that are due: their time came, or their Person
 * has no screen open anymore (the phone app went to the background, the
 * last page closed a minute ago). A push a crash cut short is due too.
 */
async function sendDue(parts: NotifierParts, at: number): Promise<void> {
	const { deps } = parts;
	const held = await deps.deliveries.held();
	const sending = await deps.deliveries.sending();
	const due = duePushes(held, sending, at, (personId) =>
		deps.inApp.isActive(personId),
	);
	for (const row of due) {
		const settings = await deps.settings.get(row.personId);
		if (inQuietHours(settings, at)) {
			await deps.deliveries.update(row.personId, row.key, {
				status: "quiet",
			});
			continue;
		}
		// A run's end showed on the open screen: no push after it.
		const seen = seenOnScreen(row.kind, () =>
			deps.inApp.isActive(row.personId),
		);
		const sent = seen
			? []
			: await sendTo(
					parts,
					await deps.targets.byIds(row.heldFor),
					await messageOf(parts, row),
				);
		await deps.deliveries.update(
			row.personId,
			row.key,
			sentHeldEntry(row, sent, at),
		);
	}
}

async function endQuietHours(parts: NotifierParts, at: number): Promise<void> {
	const { deps } = parts;
	for (const [personId, rows] of byPerson(await deps.deliveries.quiet())) {
		const settings = await deps.settings.get(personId);
		if (inQuietHours(settings, at)) continue;
		const { gates, stillWait, dropped } = quietEnd(rows);
		// Runs that ended meanwhile go without a push.
		for (const row of dropped) {
			await deps.deliveries.update(personId, row.key, {
				status: "dropped",
				heldFor: [],
			});
		}
		// Each screen hears of the Gates it held, and only of those: a
		// Space another Host sends for held this computer's own screens.
		const targets = (await deps.targets.byIds(heldTargetIds(gates))).filter(
			(target) => settings.screens[target.kind],
		);
		const sentTo = new Map<string, string[]>();
		for (const target of targets) {
			const waiting = gates.filter((row) => row.heldFor.includes(target.id));
			const [one] = waiting;
			if (waiting.length === 1 && one) {
				// One Gate: the Gate itself, so its answer withdraws it.
				const sent = await sendTo(parts, [target], await messageOf(parts, one));
				sentTo.set(one.key, [...(sentTo.get(one.key) ?? []), ...sent]);
			} else if (waiting.length > 1) {
				const key = waitingKey(at);
				// The screen was told of each Gate: each one's close withdraws it there.
				const sent = await sendTo(
					parts,
					[target],
					gatesWaitingMessage(key, waiting.length, at),
				);
				for (const row of waiting) {
					sentTo.set(row.key, [...(sentTo.get(row.key) ?? []), ...sent]);
				}
				if (sent.length > 0) {
					parts.bundles.add({
						targetId: target.id,
						key,
						gates: new Set(waiting.map((row) => row.key)),
					});
				}
			}
		}
		for (const row of stillWait) {
			const reach = (await deps.targets.byIds(row.heldFor)).filter(
				(target) => settings.screens[target.kind],
			);
			sentTo.set(
				row.key,
				await sendTo(parts, reach, await messageOf(parts, row)),
			);
		}
		for (const row of [...gates, ...stillWait]) {
			const sent = sentTo.get(row.key) ?? [];
			await deps.deliveries.update(personId, row.key, quietEndEntry(sent, at));
		}
	}
}

/** The device waits whose step did not sleep again: withdraw them. */
async function endWaits(parts: NotifierParts, at: number): Promise<void> {
	for (const { spaceId, key } of parts.waits.due(at)) {
		await close(parts, spaceId, key);
	}
}

/** Removes the entries older than the inbox keeps (90 days), once an hour. */
async function prune(parts: NotifierParts, at: number): Promise<void> {
	if (!parts.pruning.due(at)) return;
	await parts.deps.deliveries.prune(at - INBOX_KEEP_MS);
}
