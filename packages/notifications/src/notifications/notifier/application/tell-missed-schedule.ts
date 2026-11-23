import type { ScheduleMissed } from "@nightshift/engine";
import { scheduleMissedKey } from "../../../contract";
import { scheduleMissedWords } from "../domain/words";
import type { TellPeople } from "./tell-people";

export type TellMissedSchedulePorts = {
	now(): number;
	/** `tellPeople`, bound by the wire. */
	tell(notice: TellPeople): Promise<void>;
};

/**
 * A schedule's cron time was missed by more than it allows: every
 * Member of the Space hears "A schedule did not start", with the flow
 * and the time on their own clock. A push only: no open page has an
 * item for it, so it goes when the person closes their pages.
 */
export const tellMissedSchedule =
	(ports: TellMissedSchedulePorts) =>
	async (missed: ScheduleMissed): Promise<void> => {
		await ports.tell({
			kind: "schedule-missed",
			key: scheduleMissedKey(missed),
			ids: { spaceId: missed.spaceId, runId: "", stepId: null },
			inApp: false,
			words: (settings) =>
				scheduleMissedWords({
					flow: missed.flow,
					at: missed.at,
					timeZone: settings.timeZone,
					now: ports.now(),
				}),
		});
	};
