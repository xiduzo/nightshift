/**
 * Checked reads of a value whose shape nobody checked yet: a field of an
 * AG-UI chunk, a raw message of a harness.
 */

export function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/** Claude Code reports reset times in epoch seconds. Accept milliseconds too. */
export function toEpochMs(value: number): number {
	return value < 1e12 ? value * 1000 : value;
}
