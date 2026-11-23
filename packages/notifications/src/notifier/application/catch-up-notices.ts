import type { Delivery } from "../../deliveries";
import type { GateTracker } from "../domain/gate-tracker";
import type { WaitTracker } from "../domain/wait-tracker";
import type { CloseNotice } from "./close-notice";
import type { DeliveryLog, RunEvents, SpaceList } from "./ports";
import type { TellPeople } from "./tell-people";

export type CatchUpNoticesPorts = {
	spaces: SpaceList;
	gates: Pick<GateTracker, "baseline" | "isOpen" | "open">;
	waits: Pick<WaitTracker, "track">;
	deliveries: Pick<DeliveryLog, "liveOfKind">;
	events: Pick<RunEvents, "run">;
	/** `tellPeople`, bound by the wire. */
	tell(notice: TellPeople): Promise<void>;
	/** `closeNotice`, bound by the wire. */
	close(notice: CloseNotice): Promise<void>;
};

/**
 * At start: reads the open Gates of every Space. A Gate the log told that
 * closed meanwhile is withdrawn. A Gate that opened while no notifier
 * listened is pushed now (the log drops the ones already told). A device
 * wait the log told is over when its run no longer sleeps.
 */
export const catchUpNotices =
	(ports: CatchUpNoticesPorts) => async (): Promise<void> => {
		await ports.gates.baseline(await ports.spaces.all());
		// Gates that closed while this daemon was away: withdraw them now.
		const closed = new Map<string, string>();
		for (const row of await ports.deliveries.liveOfKind("gate-opened")) {
			if (!ports.gates.isOpen(row.spaceId, row.key))
				closed.set(row.key, row.spaceId);
		}
		for (const [key, spaceId] of closed) await ports.close({ spaceId, key });
		// Gates that opened while no notifier listened (a reload, a start, a
		// run that woke): pushed now. The log drops the ones already told.
		for (const { spaceId, key, runId, stepId } of ports.gates.open()) {
			await ports.tell({
				kind: "gate-opened",
				key,
				ids: { spaceId, runId, stepId },
				inApp: false,
			});
		}
		// Device waits the log told: over when their run no longer sleeps.
		const told = new Map<string, Delivery>();
		for (const row of await ports.deliveries.liveOfKind("device-wait")) {
			told.set(row.key, row);
		}
		for (const [key, row] of told) {
			const run = await ports.events.run(row.spaceId, row.runId);
			if (run?.sleeping) ports.waits.track(row.spaceId, key);
			else await ports.close({ spaceId: row.spaceId, key });
		}
	};
