import type { WaitTracker } from "../domain/wait-tracker";
import type { CloseNotice } from "./close-notice";

export type EndDeviceWaitsPorts = {
	waits: Pick<WaitTracker, "due">;
	/** `closeNotice`, bound by the wire. */
	close(notice: CloseNotice): Promise<void>;
};

/** The instant of the check. */
export type EndDeviceWaits = { at: number };

/** The device waits whose step did not sleep again: withdraw them. */
export const endDeviceWaits =
	(ports: EndDeviceWaitsPorts) =>
	async ({ at }: EndDeviceWaits): Promise<void> => {
		for (const { spaceId, key } of ports.waits.due(at)) {
			await ports.close({ spaceId, key });
		}
	};
