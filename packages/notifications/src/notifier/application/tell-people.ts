import type { GateUrgency } from "@nightshift/flows";
import type { NotificationMessage } from "../../channels";
import type { Claim, NoticeKind } from "../../deliveries";
import {
	inQuietHours,
	type NotificationSettings,
	pushesUrgency,
} from "../../settings";
import type { GateTracker } from "../domain/gate-tracker";
import {
	claimOf,
	type NoticeIds,
	noticeMessage,
	pushMessageOf,
} from "../domain/message";
import {
	heldTargets,
	pushedEntry,
	reachable,
	sendingClaim,
	sendToEach,
	wants,
} from "../domain/pushes";
import type { NoticeWords } from "../domain/words";
import type {
	Audience,
	DeliveryLog,
	InApp,
	MayAnswer,
	PersonSettings,
	Pushes,
	PushTargets,
	SendsFor,
} from "./ports";

export type TellPeoplePorts = {
	sendsFor: SendsFor;
	audience: Audience;
	settings: PersonSettings;
	inApp: Pick<InApp, "send" | "isActive">;
	targets: Pick<PushTargets, "of" | "forget">;
	pushes: Pushes;
	deliveries: Pick<DeliveryLog, "claim" | "update">;
	/** What the engine said of each open Gate: its lock-screen mark and options. */
	gates: Pick<GateTracker, "factsOf">;
	mayAnswer: MayAnswer;
	now(): number;
	/** Where a push or a withdraw that did not go out is told. */
	onError(message: string, error: unknown): void;
};

/**
 * One event to tell. `inApp` false: pushes only, for a Gate found open at
 * start (the open pages read everything again when they connect).
 * `people`: only these of the Space's audience. `words`: what it says to
 * each Person, when it says more than the sentence of its kind. `urgency`:
 * a Gate's urgency, only the urgencies the Person chose push.
 */
export type TellPeople = {
	kind: NoticeKind;
	key: string;
	ids: NoticeIds;
	inApp?: boolean;
	people?: readonly string[];
	words?: (settings: NotificationSettings) => NoticeWords;
	urgency?: GateUrgency | undefined;
};

/**
 * Tells every screen of the people about one event: the Space's
 * audience, unless `people` names some of them. Each open page hears of
 * it at once. A push goes out, or waits, once per key.
 */
export const tellPeople =
	(ports: TellPeoplePorts) =>
	async (notice: TellPeople): Promise<void> => {
		const { kind, key, ids } = notice;
		const inApp = notice.inApp ?? true;
		const sends = await ports.sendsFor.sends(ids.spaceId);
		for (const personId of notice.people ??
			(await ports.audience.of(ids.spaceId))) {
			const settings = await ports.settings.get(personId);
			const wanted = wants(settings, kind);
			const words = notice.words?.(settings);
			// Quiet hours hold the alert of an open page too: it only updates.
			const alert =
				inApp && sends && wanted && !inQuietHours(settings, ports.now());
			if (inApp) {
				await ports.inApp.send(
					{ kind: "in-app", personId },
					noticeMessage(kind, key, ids, alert, ports.now(), words),
				);
			}
			// A Gate of an urgency the Person does not push for: the inbox only.
			const pushes =
				wanted &&
				(notice.urgency === undefined ||
					pushesUrgency(settings, notice.urgency));
			if (pushes) {
				const msg = await pushMessageOf(
					{ kind, key, ids, personId, words },
					ports.now(),
					(spaceId, gate) => ports.gates.factsOf(spaceId, gate),
					(spaceId, person) => ports.mayAnswer.allows(spaceId, person),
				);
				await push(
					ports,
					claimOf(personId, key, kind, ids, words),
					settings,
					{ ...msg, toldInApp: alert },
					sends,
				);
			}
		}
	};

/**
 * Pushes one event to one Person, or holds it: once per key. `sends`:
 * this daemon sends the Space's pushes. Else only this computer's own
 * screens get it. The claim goes in the log before the push goes out.
 */
async function push(
	ports: TellPeoplePorts,
	claim: Claim,
	settings: NotificationSettings,
	msg: NotificationMessage,
	sends: boolean,
): Promise<void> {
	const at = ports.now();
	const targets = reachable(
		(await ports.targets.of(claim.personId)).filter(
			(target) => settings.screens[target.kind] && ports.pushes[target.kind],
		),
		sends,
	);
	if (targets.length === 0) {
		if (sends) await ports.deliveries.claim(claim, { status: "dropped" }, at);
		return;
	}
	if (inQuietHours(settings, at)) {
		await ports.deliveries.claim(
			claim,
			{ status: "quiet", heldFor: targets.map((t) => t.id) },
			at,
		);
		return;
	}
	const holding =
		settings.holdMinutes > 0 && ports.inApp.isActive(claim.personId);
	const held = heldTargets(targets, holding);
	const immediate = targets.filter((t) => !held.includes(t));
	const ids = targets.map((t) => t.id);
	// Every target until the push went out (`sendHeldPushes` checks them).
	const sending = sendingClaim(ids, held.length > 0, at, settings.holdMinutes);
	if (!(await ports.deliveries.claim(claim, sending, at))) return;
	const sentTo = await sendToEach(
		immediate,
		msg,
		ports.pushes,
		(id) => ports.targets.forget(id),
		ports.onError,
	);
	const entry = pushedEntry(
		sentTo,
		held.map((t) => t.id),
		at,
	);
	await ports.deliveries.update(claim.personId, claim.key, entry);
}
