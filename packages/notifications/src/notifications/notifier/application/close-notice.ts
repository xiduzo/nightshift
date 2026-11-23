import type { Bundles } from "../domain/notifier-state";
import { withdrawFromEach, withdrawnEntry } from "../domain/pushes";
import type {
	Audience,
	DeliveryLog,
	InApp,
	Pushes,
	PushTargets,
} from "./ports";

export type CloseNoticePorts = {
	audience: Audience;
	inApp: Pick<InApp, "withdraw">;
	deliveries: Pick<DeliveryLog, "live" | "update">;
	bundles: Pick<Bundles, "closed">;
	targets: Pick<PushTargets, "byIds">;
	pushes: Pushes;
	now(): number;
	/** Where a push or a withdraw that did not go out is told. */
	onError(message: string, error: unknown): void;
};

/** The event of the key, in its Space. */
export type CloseNotice = { spaceId: string; key: string };

/**
 * A Gate closed, or a device wait is over: withdraw it everywhere, and
 * drop what still waits. The open pages of the Space's audience first,
 * then each push that went out or waits, then each "N Gates wait for you"
 * push whose last Gate just closed.
 */
export const closeNotice =
	(ports: CloseNoticePorts) =>
	async ({ spaceId, key }: CloseNotice): Promise<void> => {
		for (const personId of await ports.audience.of(spaceId)) {
			await ports.inApp.withdraw({ kind: "in-app", personId }, key);
		}
		for (const row of await ports.deliveries.live(key)) {
			await withdrawFrom(ports, row.sentTo, key);
			const entry = withdrawnEntry(row, ports.now());
			await ports.deliveries.update(row.personId, key, entry);
		}
		for (const bundle of ports.bundles.closed(key)) {
			await withdrawFrom(ports, [bundle.targetId], bundle.key);
		}
	};

/** Takes the push of the key back from each target of the ids. */
async function withdrawFrom(
	ports: CloseNoticePorts,
	ids: string[],
	key: string,
): Promise<void> {
	const targets = await ports.targets.byIds(ids);
	await withdrawFromEach(targets, key, ports.pushes, ports.onError);
}
