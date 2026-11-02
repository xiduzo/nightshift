import { usageEventSchema } from "@nightshift/semconv";

import { parseUsageEvent } from "./parse";

/** A usage event name, as the generated schema keys it. */
export type UsageEventName = keyof typeof usageEventSchema;

type SchemaField = {
	options?: unknown;
	unwrap?: () => SchemaField;
};

const schemas = usageEventSchema as unknown as Record<
	UsageEventName,
	{ shape: Record<string, SchemaField> }
>;

/** The attribute whose name is `tail` or ends with `.tail`. */
export function attr(name: UsageEventName, tail: string): string {
	const keys = Object.keys(schemas[name].shape).filter(
		(key) => key === tail || key.endsWith(`.${tail}`),
	);
	if (keys.length !== 1) {
		throw new Error(`No single usage attribute matches ${tail}.`);
	}
	return keys[0] as string;
}

function enumOptions(field: SchemaField | undefined): readonly string[] | null {
	let current = field;
	for (let depth = 0; depth < 5 && current; depth++) {
		if (Array.isArray(current.options))
			return current.options as readonly string[];
		if (typeof current.unwrap === "function") {
			current = current.unwrap();
			continue;
		}
		return null;
	}
	return null;
}

/** `value` when the attribute's closed list contains it. */
export function known(
	name: UsageEventName,
	tail: string,
	value: string,
): string | undefined {
	const options = enumOptions(schemas[name].shape[attr(name, tail)]);
	return options?.includes(value) ? value : undefined;
}

/** `value` when the list contains it, otherwise `fallback` when that is listed. */
export function listed(
	name: UsageEventName,
	tail: string,
	value: string,
	fallback: string,
): string {
	return known(name, tail, value) ?? known(name, tail, fallback) ?? fallback;
}

/**
 * One event. Unknown attributes and values outside a closed list never
 * get here: `parseUsageEvent` is the allowlist, and a failure stores nothing.
 */
export function eventOf(
	name: UsageEventName,
	fields: Record<string, unknown>,
): Record<string, unknown> | null {
	try {
		const body: Record<string, unknown> = { name };
		for (const [tail, value] of Object.entries(fields)) {
			if (value === undefined) continue;
			body[attr(name, tail)] = value;
		}
		return parseUsageEvent({ ...body, name }) as Record<string, unknown>;
	} catch {
		return null;
	}
}
