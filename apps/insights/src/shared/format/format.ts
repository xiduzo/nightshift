/** A count, with a thousands separator. */
export function count(value: number): string {
	return value.toLocaleString("en-US");
}

/** A ratio as a percent. Null means there is no rate yet. */
export function percent(value: number | null): string {
	if (value == null) return "No rate yet";
	const shown = (value * 100).toLocaleString("en-US", {
		maximumFractionDigits: 1,
	});
	return `${shown}%`;
}

/** A cost in US dollars. Null means there is no cost yet. */
export function dollars(value: number | null): string {
	if (value == null) return "No cost yet";
	const shown = value.toLocaleString("en-US", { maximumFractionDigits: 2 });
	return `$${shown}`;
}

/** A duration in seconds, in the shortest unit that still fits. */
export function duration(seconds: number | null): string {
	if (seconds == null) return "No time yet";
	const whole = Math.max(0, Math.round(seconds));
	if (whole < 60) return unit(whole, "second", "seconds");
	const minutes = Math.round(whole / 60);
	if (minutes < 60) return unit(minutes, "minute", "minutes");
	const hours = Math.round(minutes / 60);
	if (hours < 48) return unit(hours, "hour", "hours");
	return unit(Math.round(hours / 24), "day", "days");
}

function unit(value: number, one: string, many: string): string {
	return `${value} ${value === 1 ? one : many}`;
}
