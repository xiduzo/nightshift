import { eventIterator, type Schema } from "@orpc/contract";
import { z } from "zod";

/**
 * Output schemas of the Host's procedures that describe a reply and never
 * change it, as the API's do (`@nightshift/api`, `output.ts`). oRPC sends
 * the value an output schema returns, and a zod object drops the keys it
 * does not name. So a described schema checks the reply and sends the
 * handler's own value. A reply that does not match is logged, not refused:
 * a Host never breaks the link of a Device over a description.
 */

/** The value of the reply, as it went out, and why it does not match its schema. */
export type ReplyMismatch = { issues: readonly unknown[]; value: unknown };

let report = (mismatch: ReplyMismatch): void => {
	console.warn(
		"[devices] a Host reply does not match its output schema:",
		JSON.stringify(mismatch.issues.slice(0, 5)),
	);
};

/** Replaces what a mismatch does (the default logs it). For tests. */
export function onReplyMismatch(
	handler: (mismatch: ReplyMismatch) => void,
): () => void {
	const previous = report;
	report = handler;
	return () => {
		report = previous;
	};
}

/** The output schema of a procedure that answers once: the schema for OpenAPI, whose check sends the reply unchanged. */
export function described<S extends z.ZodType>(schema: S): S {
	const checked = Object.create(schema) as S;
	const standard = schema["~standard"];
	Object.defineProperty(checked, "~standard", {
		value: {
			...standard,
			async validate(value: unknown) {
				const result = await standard.validate(value);
				if (result.issues) report({ issues: result.issues, value });
				return { value };
			},
		},
	});
	const meta = z.globalRegistry.get(schema);
	if (meta) z.globalRegistry.add(checked, meta);
	return checked;
}

/**
 * The output schema of a streaming procedure: what each event holds. It
 * describes the events and does not touch them. `T` is the event as the
 * Host yields it, when the wire schema describes it more loosely (a
 * transcript entry's `event`).
 */
export function describedStream<S extends z.ZodType, T = z.output<S>>(
	events: S,
): Schema<AsyncIterable<T>, AsyncIterable<T>> {
	const schema = eventIterator(events);
	const standard = schema["~standard"];
	return {
		...schema,
		"~standard": {
			...standard,
			validate: (iterator: unknown) => ({ value: iterator }),
		},
	} as unknown as Schema<AsyncIterable<T>, AsyncIterable<T>>;
}

/** A and B are the same type, after intersections are flattened. */
type Same<A, B> =
	(<T>() => T extends Flat<A> ? 1 : 2) extends <T>() => T extends Flat<B>
		? 1
		: 2
		? true
		: false;

/** Flattens intersections, eight levels deep: a recursive type (JSON) ends there. */
type Flat<T, Depth extends unknown[] = []> = Depth["length"] extends 8
	? T
	: T extends object
		? { [K in keyof T]: Flat<T[K], [...Depth, unknown]> }
		: T;

/**
 * Checks, when the code compiles, that a schema's output is exactly the
 * type `T` of another package (the engine's): a field added, dropped or
 * changed there fails the build until the schema follows.
 */
export function exact<T>() {
	return <S extends z.ZodType>(
		schema: S &
			(Same<z.output<S>, T> extends true
				? unknown
				: { "the schema's output differs from": T }),
	): S => schema;
}
