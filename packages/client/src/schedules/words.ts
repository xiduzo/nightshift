import { describeCron, type Schedule } from "@nightshift/flows";

/** What a schedule starts, for its name: its flow, else its signal. */
export function scheduleName(
	schedule: Pick<Schedule, "id" | "flow" | "signal">,
): string {
	return schedule.flow ?? schedule.signal?.name ?? schedule.id;
}

/** When it starts, in words: its cron line, or a webhook. */
export function scheduleWhen(
	schedule: Pick<Schedule, "cron" | "webhook">,
): string {
	if (schedule.webhook) return "When a webhook arrives";
	if (!schedule.cron) return "Never";
	const text = describeCron(schedule.cron);
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "yesterday", "today", "tomorrow", or the weekday, for a moment in the days around `now`, on this clock. */
export function dayWord(epochMs: number, now = Date.now()): string {
	const day = (ms: number) => {
		const date = new Date(ms);
		return new Date(
			date.getFullYear(),
			date.getMonth(),
			date.getDate(),
		).getTime();
	};
	const days = Math.round((day(epochMs) - day(now)) / (24 * 60 * 60 * 1000));
	if (days === -1) return "yesterday";
	if (days === 0) return "today";
	if (days === 1) return "tomorrow";
	return new Date(epochMs).toLocaleDateString(undefined, { weekday: "long" });
}
