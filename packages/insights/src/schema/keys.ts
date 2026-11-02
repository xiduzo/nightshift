import { USAGE_EVENT, usageEventSchema } from "@nightshift/semconv";
import { type SQL, sql } from "drizzle-orm";

/** A usage event name, as the generated schema keys it. */
export type UsageEventName = keyof typeof usageEventSchema;

type SchemaField = {
	options?: readonly string[];
	unwrap?: () => SchemaField;
};

const schemas = usageEventSchema as unknown as Record<
	UsageEventName,
	{ shape: Record<string, SchemaField> }
>;

/** The attribute whose name is `tail` or ends with `.tail`. */
export function attribute(name: UsageEventName, tail: string): string {
	const keys = Object.keys(schemas[name].shape).filter(
		(key) => key === tail || key.endsWith(`.${tail}`),
	);
	if (keys.length !== 1) {
		throw new Error(`No single usage attribute matches ${tail}.`);
	}
	return keys[0] as string;
}

function optionsOf(field: SchemaField | undefined): readonly string[] | null {
	let current = field;
	for (let depth = 0; depth < 5 && current; depth += 1) {
		if (Array.isArray(current.options)) return current.options;
		if (typeof current.unwrap === "function") {
			current = current.unwrap();
			continue;
		}
		return null;
	}
	return null;
}

/** A closed value of one attribute. Fails when the registry has no such value. */
export function member(
	name: UsageEventName,
	tail: string,
	value: string,
): string {
	const found = optionsOf(schemas[name].shape[attribute(name, tail)])?.find(
		(option) => option === value,
	);
	if (!found) throw new Error(`No registry value ${value} for ${tail}.`);
	return found;
}

/** Every closed value of one attribute. */
export function members(name: UsageEventName, tail: string): readonly string[] {
	const options = optionsOf(schemas[name].shape[attribute(name, tail)]);
	if (!options) throw new Error(`No closed list for ${tail}.`);
	return options;
}

function token(value: string, pattern: RegExp): string {
	if (!pattern.test(value)) throw new Error("Unexpected registry value.");
	return value;
}

/** A SQL string literal. The value comes from the registry, not from a request. */
export function lit(value: string): SQL {
	return sql.raw(`'${token(value, /^[\w.-]+$/)}'`);
}

/** `event_name = '<registry name>'`. */
export function eventIs(name: string): SQL {
	return sql.raw(`event_name = '${token(name, /^[\w.]+$/)}'`);
}

function jsonKey(name: UsageEventName, tail: string): string {
	return `attributes->>'${token(attribute(name, tail), /^[\w.]+$/)}'`;
}

export function jsonText(name: UsageEventName, tail: string): SQL {
	return sql.raw(jsonKey(name, tail));
}

export function jsonNumber(name: UsageEventName, tail: string): SQL {
	return sql.raw(`(${jsonKey(name, tail)})::double precision`);
}

export function jsonBool(name: UsageEventName, tail: string): SQL {
	return sql.raw(`(${jsonKey(name, tail)})::boolean`);
}

/** A column name this package chose. Not a request value. */
export function ident(name: string): SQL {
	return sql.raw(token(name, /^[a-z_]+$/));
}

export const RUN = USAGE_EVENT.runEnded;
export const OPENED = USAGE_EVENT.pullRequestOpened;
export const OUTCOME = USAGE_EVENT.pullRequestOutcome;
export const GATE = USAGE_EVENT.gateAnswered;
export const ACTIVE = USAGE_EVENT.installActive;
export const STARTED = USAGE_EVENT.installStarted;
export const FLOW = USAGE_EVENT.flowCreated;
export const AGENT = USAGE_EVENT.agentChecked;
export const PROJECT = USAGE_EVENT.projectAdded;
export const CHECKED = USAGE_EVENT.projectChecked;
export const SCHEDULE = USAGE_EVENT.scheduleChanged;

export const FINISHED = member(RUN, "run.status", "finished");
export const MERGED = member(OUTCOME, "pull_request.outcome", "merged");
export const CLOSED = member(OUTCOME, "pull_request.outcome", "closed");
export const REVERTED = member(OUTCOME, "pull_request.outcome", "reverted");
export const BY_PERSON = member(GATE, "gate.by", "person");
export const BY_DEADLINE = member(GATE, "gate.by", "deadline");
export const VIA_PHONE = member(GATE, "gate.via", "phone");
export const VIA_WEB = member(GATE, "gate.via", "web");
export const VIA_LOCK = member(GATE, "gate.via", "lock_screen");

/** Hours in seven days. A revert inside this window is rework. */
export const REWORK_HOURS = 24 * 7;
