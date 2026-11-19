import { REGISTRY } from "@nightshift/semconv";

/**
 * Checks exported spans and metrics against the resolved registry.
 * A name, a type or a unit the registry does not define fails.
 * A required attribute that is missing fails. `error.type` is required
 * on a failed span when that span's registry entry lists it.
 */

type Attributes = Record<string, unknown>;

export type ConformanceSpan = {
	name: string;
	/** The span status is Error. */
	failed: boolean;
	attributes: Attributes;
};

export type ConformanceMetric = {
	name: string;
	unit: string;
	instrument: string;
	points: { attributes: Attributes }[];
};

type SpanSpec = {
	prefix: string;
	required: readonly string[];
	attributes: readonly string[];
};

const attributes = REGISTRY.attributes as Record<
	string,
	{ type: string; members?: readonly string[] }
>;
const metrics = REGISTRY.metrics as Record<
	string,
	{ instrument: string; unit: string; required: readonly string[] }
>;
const spans = Object.values(REGISTRY.spans) as SpanSpec[];

function valueOk(type: string, value: unknown): boolean {
	if (type === "string") return typeof value === "string";
	if (type === "boolean") return typeof value === "boolean";
	if (type === "int")
		return typeof value === "number" && Number.isInteger(value);
	if (type === "double") return typeof value === "number";
	if (type === "string[]") {
		return (
			Array.isArray(value) && value.every((item) => typeof item === "string")
		);
	}
	return false;
}

function spanOf(name: string): SpanSpec | null {
	let best: SpanSpec | null = null;
	for (const spec of spans) {
		if (spec.prefix.length === 0) continue;
		const hit = name === spec.prefix || name.startsWith(`${spec.prefix} `);
		if (!hit) continue;
		if (!best || spec.prefix.length > best.prefix.length) best = spec;
	}
	return best;
}

function checkAttributes(
	problems: string[],
	where: string,
	values: Attributes,
	required: readonly string[],
): void {
	for (const [key, value] of Object.entries(values)) {
		const defined = attributes[key];
		if (!defined) {
			problems.push(`${where} has ${key}, which the registry does not define.`);
			continue;
		}
		if (!valueOk(defined.type, value)) {
			problems.push(
				`${where} has ${key} as ${typeof value}, not ${defined.type}.`,
			);
		}
	}
	for (const key of required) {
		if (values[key] === undefined) {
			problems.push(`${where} is missing ${key}.`);
		}
	}
}

/** What is wrong with this export. Empty when it matches the registry. */
export function conformanceProblems(input: {
	spans: readonly ConformanceSpan[];
	metrics: readonly ConformanceMetric[];
}): string[] {
	const problems: string[] = [];
	for (const span of input.spans) {
		const spec = spanOf(span.name);
		if (!spec) {
			problems.push(`Span ${span.name} is not in the registry.`);
			continue;
		}
		const where = `Span ${span.name}`;
		checkAttributes(problems, where, span.attributes, spec.required);
		if (
			span.failed &&
			spec.attributes.includes("error.type") &&
			span.attributes["error.type"] === undefined
		) {
			problems.push(`${where} is missing error.type.`);
		}
		const errorType = span.attributes["error.type"];
		if (typeof errorType === "string" && /\s/.test(errorType)) {
			problems.push(`${where} has a free-text error.type.`);
		}
	}
	for (const metric of input.metrics) {
		const spec = metrics[metric.name];
		if (!spec) {
			problems.push(`Metric ${metric.name} is not in the registry.`);
			continue;
		}
		if (metric.unit !== spec.unit) {
			problems.push(
				`Metric ${metric.name} has unit ${metric.unit}, not ${spec.unit}.`,
			);
		}
		if (metric.instrument !== spec.instrument) {
			problems.push(
				`Metric ${metric.name} is a ${metric.instrument}, not a ${spec.instrument}.`,
			);
		}
		for (const point of metric.points) {
			checkAttributes(
				problems,
				`Metric ${metric.name}`,
				point.attributes,
				spec.required,
			);
		}
	}
	return problems;
}

/** Throws when the export does not match the registry. */
export function assertConforms(input: {
	spans: readonly ConformanceSpan[];
	metrics: readonly ConformanceMetric[];
}): void {
	const problems = conformanceProblems(input);
	if (problems.length > 0) throw new Error(problems.join("\n"));
}
