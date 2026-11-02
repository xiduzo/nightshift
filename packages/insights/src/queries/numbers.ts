export function asNumber(value: unknown): number {
	if (typeof value === "number") return Number.isFinite(value) ? value : 0;
	if (typeof value === "bigint") return Number(value);
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

export function asNumberOrNull(value: unknown): number | null {
	if (value == null) return null;
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "bigint") return Number(value);
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

/** `part / whole`. Null when the whole is 0. */
export function ratio(part: number, whole: number): number | null {
	if (whole === 0) return null;
	return part / whole;
}

export function asText(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}
