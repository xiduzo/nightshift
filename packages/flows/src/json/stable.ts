import { isRecord } from "./record";

/** JSON with the keys of every object sorted: two equal values give one text. */
export function stableJson(value: unknown): string {
	return (
		JSON.stringify(value, (_key, inner: unknown) =>
			isRecord(inner)
				? Object.fromEntries(
						Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1)),
					)
				: inner,
		) ?? "undefined"
	);
}
