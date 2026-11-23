import type { GateUrgency } from "@nightshift/flows";
import type { NotificationMessage, PushTarget } from "../channels";
import type { Claim, Delivery, NoticeKind } from "../deliveries";
import {
	inQuietHours,
	type NotificationSettings,
	pushesUrgency,
} from "../settings";
import {
	claimOf,
	type GateFacts,
	gateFactsOf,
	keptWords,
	type NoticeIds,
	noticeMessage,
} from "./domain/message";
import {
	heldTargets,
	pushedEntry,
	reachable,
	sendingClaim,
	wants,
	withdrawnEntry,
} from "./domain/pushes";
import type { NoticeWords } from "./domain/words";
import type { NotifierParts } from "./parts";

/** How the notifier tells people of an event, and takes it back: the steps its pieces of work share. */

/** What a push about the Gate may show the Person: `mayAnswer` is asked only for a Gate marked for the lock screen. */
async function gateFacts(
	parts: NotifierParts,
	key: string,
	spaceId: string,
	personId: string,
): Promise<GateFacts> {
	const ref = parts.gates.factsOf(spaceId, key);
	return gateFactsOf(
		ref,
		ref?.lockScreen === true && (await parts.mayAnswer(spaceId, personId)),
	);
}

/** The message a push sends: a Gate's adds what its notification may show. */
async function pushMessage(
	parts: NotifierParts,
	kind: NoticeKind,
	key: string,
	ids: NoticeIds,
	personId: string,
	words?: NoticeWords,
): Promise<NotificationMessage> {
	const msg = noticeMessage(kind, key, ids, true, parts.now(), words);
	if (kind !== "gate-opened") return msg;
	return { ...msg, gate: await gateFacts(parts, key, ids.spaceId, personId) };
}

/** The Person's push targets their settings allow and a channel can reach. */
async function pushTargets(
	parts: NotifierParts,
	personId: string,
	settings: NotificationSettings,
): Promise<PushTarget[]> {
	const { deps } = parts;
	return (await deps.targets.of(personId)).filter(
		(target) => settings.screens[target.kind] && deps.push[target.kind],
	);
}

/** Sends to each target. Returns the ids that got it. Forgets a target its service lost. */
export async function sendTo(
	parts: NotifierParts,
	targets: readonly PushTarget[],
	msg: NotificationMessage,
): Promise<string[]> {
	const { deps } = parts;
	const sent: string[] = [];
	for (const target of targets) {
		const channel = deps.push[target.kind];
		if (!channel) continue;
		try {
			const result = await channel.send(target, msg);
			if (result === "gone") await deps.targets.forget(target.id);
			else sent.push(target.id);
		} catch (error) {
			parts.onError(`A ${target.kind} push did not go out.`, error);
		}
	}
	return sent;
}

/**
 * Tells every screen of the people about one event: the Space's
 * audience, unless `people` names some of them. `inApp` false: pushes
 * only, for a Gate found open at start (the open pages read everything
 * again when they connect). `words`: what it says to each Person, when
 * it says more than the sentence of its kind.
 */
export async function tell(
	parts: NotifierParts,
	kind: NoticeKind,
	key: string,
	ids: NoticeIds,
	options: {
		inApp?: boolean;
		people?: readonly string[];
		words?: (settings: NotificationSettings) => NoticeWords;
		/** A Gate's urgency: only the urgencies the Person chose push. */
		urgency?: GateUrgency;
	} = {},
): Promise<void> {
	const { deps, now } = parts;
	const inApp = options.inApp ?? true;
	const sends = await deps.sendsFor(ids.spaceId);
	for (const personId of options.people ?? (await deps.audience(ids.spaceId))) {
		const settings = await deps.settings.get(personId);
		const wanted = wants(settings, kind);
		const words = options.words?.(settings);
		// Quiet hours hold the alert of an open page too: it only updates.
		const alert = inApp && sends && wanted && !inQuietHours(settings, now());
		if (inApp) {
			await deps.inApp.send(
				{ kind: "in-app", personId },
				noticeMessage(kind, key, ids, alert, now(), words),
			);
		}
		// A Gate of an urgency the Person does not push for: the inbox only.
		const pushes =
			wanted &&
			(options.urgency === undefined ||
				pushesUrgency(settings, options.urgency));
		if (pushes) {
			await push(
				parts,
				claimOf(personId, key, kind, ids, words),
				settings,
				{
					...(await pushMessage(parts, kind, key, ids, personId, words)),
					toldInApp: alert,
				},
				sends,
			);
		}
	}
}

/**
 * Pushes one event to one Person, or holds it: once per key. `sends`:
 * this daemon sends the Space's pushes. Else only this computer's own
 * screens get it.
 */
async function push(
	parts: NotifierParts,
	claim: Claim,
	settings: NotificationSettings,
	msg: NotificationMessage,
	sends: boolean,
): Promise<void> {
	const { deps } = parts;
	const at = parts.now();
	const targets = reachable(
		await pushTargets(parts, claim.personId, settings),
		sends,
	);
	if (targets.length === 0) {
		if (sends) await deps.deliveries.claim(claim, { status: "dropped" }, at);
		return;
	}
	if (inQuietHours(settings, at)) {
		await deps.deliveries.claim(
			claim,
			{ status: "quiet", heldFor: targets.map((t) => t.id) },
			at,
		);
		return;
	}
	const holding =
		settings.holdMinutes > 0 && deps.inApp.isActive(claim.personId);
	const held = heldTargets(targets, holding);
	const immediate = targets.filter((t) => !held.includes(t));
	const ids = targets.map((t) => t.id);
	const holdMinutes = settings.holdMinutes;
	// Every target until the push went out (`sendDue` checks them).
	const sending = sendingClaim(ids, held.length > 0, at, holdMinutes);
	if (!(await deps.deliveries.claim(claim, sending, at))) return;
	const sentTo = await sendTo(parts, immediate, msg);
	const heldIds = held.map((t) => t.id);
	const entry = pushedEntry(sentTo, heldIds, at);
	await deps.deliveries.update(claim.personId, claim.key, entry);
}

/** A Gate closed, or a device wait is over: withdraw it everywhere, and drop what still waits. */
export async function close(
	parts: NotifierParts,
	spaceId: string,
	key: string,
): Promise<void> {
	const { deps } = parts;
	for (const personId of await deps.audience(spaceId)) {
		await deps.inApp.withdraw({ kind: "in-app", personId }, key);
	}
	for (const row of await deps.deliveries.live(key)) {
		await withdrawFrom(parts, row.sentTo, key);
		const entry = withdrawnEntry(row, parts.now());
		await deps.deliveries.update(row.personId, key, entry);
	}
	// Each "N Gates wait for you" push whose last Gate just closed.
	for (const bundle of parts.bundles.closed(key)) {
		await withdrawFrom(parts, [bundle.targetId], bundle.key);
	}
}

/** Takes the push of the key back from each target of the ids. */
async function withdrawFrom(
	parts: NotifierParts,
	ids: string[],
	key: string,
): Promise<void> {
	const { deps } = parts;
	for (const target of await deps.targets.byIds(ids)) {
		try {
			await deps.push[target.kind]?.withdraw(target, key);
		} catch (error) {
			parts.onError(`A ${target.kind} withdraw did not go out.`, error);
		}
	}
}

/** The message of a held entry, as it went out the first time. */
export function messageOf(
	parts: NotifierParts,
	row: Delivery,
): Promise<NotificationMessage> {
	return pushMessage(
		parts,
		row.kind,
		row.key,
		{ spaceId: row.spaceId, runId: row.runId, stepId: row.stepId },
		row.personId,
		keptWords(row),
	);
}
