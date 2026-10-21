import { eventIterator } from "@orpc/server";
import { z } from "zod";

/**
 * Output schemas that describe what a procedure returns, and never change it.
 *
 * oRPC sends the value an output schema returns, and a zod object drops the
 * keys it does not name. So `output` checks the reply with its schema and
 * sends the handler's own value, unchanged. A reply that does not match is
 * logged, not refused: a schema is the description of the API (OpenAPI, agent
 * tools), and an error in it must not break a page. The tests check the
 * schemas against real replies, and `exact` checks them against the domain
 * types when the code compiles.
 */

/** The value of the reply, as it went out, and why it does not match its schema. */
export type OutputMismatch = { issues: readonly unknown[]; value: unknown };

let report = (mismatch: OutputMismatch): void => {
	console.warn(
		"[api] a reply does not match its output schema:",
		JSON.stringify(mismatch.issues.slice(0, 5)),
	);
};

/** Replaces what a mismatch does (the default logs it). For tests. */
export function onOutputMismatch(
	handler: (mismatch: OutputMismatch) => void,
): () => void {
	const previous = report;
	report = handler;
	return () => {
		report = previous;
	};
}

/**
 * The output schema of a procedure: the zod schema itself for OpenAPI, whose
 * check sends the handler's value unchanged.
 */
export function output<S extends z.ZodType>(schema: S): S {
	const described = Object.create(schema) as S;
	const standard = schema["~standard"];
	Object.defineProperty(described, "~standard", {
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
	if (meta) z.globalRegistry.add(described, meta);
	return described;
}

/**
 * The output schema of a streaming procedure: what each event holds. It
 * describes the events (OpenAPI, agent tools) and does not touch them. The
 * stream goes out as the handler yields it, not wrapped.
 */
export function stream<S extends z.ZodType>(events: S) {
	const schema = eventIterator(events);
	const standard = schema["~standard"];
	return {
		...schema,
		"~standard": {
			...standard,
			validate: (iterator: unknown) => ({ value: iterator }),
		},
	} as typeof schema;
}

/** A and B are the same type, after intersections are flattened. */
export type Same<A, B> =
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
 * domain type `T`: a field the engine adds, drops or changes fails the build
 * until the schema follows. `exact<RunSummary>()(z.object({ … }))`.
 */
export function exact<T>() {
	return <S extends z.ZodType>(
		schema: S &
			(Same<z.output<S>, T> extends true
				? unknown
				: { "the schema's output differs from": T }),
	): S => schema;
}
