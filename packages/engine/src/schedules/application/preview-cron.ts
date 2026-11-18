import { cronError, describeCron, nextCronTimes } from "@nightshift/flows";
import type { Actor } from "../../contract";
import type { Clock } from "./ports";

export type PreviewCronPorts = { clock: Clock };

export type PreviewCron = {
	/** The cron line a person typed, for example `0 22 * * 1-5`. */
	cron: string;
	/** How many of its next times to give. Default 3. */
	count?: number | undefined;
	/** The clock the times are on, such as `Europe/Amsterdam`. Default: this computer's. */
	timeZone?: string | undefined;
};

/** How a cron line reads. */
export type CronPreview = {
	/** Why the cron line is not valid. Null when it is. */
	error: string | null;
	/** The cron line in words. Null when it is not valid. */
	description: string | null;
	/** Its next times, from now (epoch ms). Empty when it is not valid. */
	times: number[];
};

/**
 * Reads a cron line for the person who types it: how it reads, and its
 * next times from now on the given clock. It never refuses: a line that
 * is not valid comes back with the reason.
 */
export const previewCron =
	(ports: PreviewCronPorts) =>
	async (
		_actor: Actor | undefined,
		request: PreviewCron,
	): Promise<CronPreview> => {
		const error = cronError(request.cron);
		return {
			error,
			description: error ? null : describeCron(request.cron),
			times: error
				? []
				: nextCronTimes(
						request.cron,
						ports.clock(),
						request.count ?? 3,
						request.timeZone,
					),
		};
	};
