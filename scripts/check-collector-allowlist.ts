/**
 * The Collector allowlist is the usage export, no more and no less.
 *
 * `deploy/insights/collector.yaml` may allow only keys the registry defines.
 * It must allow every key the usage export sends: the usage-event
 * attributes from `@nightshift/semconv`, the resource attributes in
 * `packages/telemetry/src/usage/send.ts`, and the event name that file
 * writes. The event name is a log field. The registry does not list it
 * as an attribute. The check still requires it, because the export sends
 * it and the redaction processor would drop it.
 *
 *   bun scripts/check-collector-allowlist.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ATTR, REGISTRY, usageEventSchema } from "@nightshift/semconv";

const COLLECTOR = "deploy/insights/collector.yaml";
const USAGE_SEND = "packages/telemetry/src/usage/send.ts";

type Redaction = {
	allow_all_keys?: boolean;
	allowed_keys?: unknown;
};

/** Resource attribute keys `resourceFromAttributes` writes in `source`. */
export function resourceKeysFrom(source: string): string[] {
	const start = source.indexOf("resourceFromAttributes(");
	const end = source.indexOf("processors:", start);
	if (start < 0 || end < 0) {
		throw new Error("The usage export has no resource attributes.");
	}
	const block = source.slice(start, end);
	const keys = new Set<string>();
	for (const match of block.matchAll(/ATTR\.(\w+)/g)) {
		const name = match[1] as keyof typeof ATTR;
		const value = ATTR[name];
		if (typeof value !== "string") {
			throw new Error(`ATTR.${name} is not a usage resource key.`);
		}
		keys.add(value);
	}
	if (keys.size === 0) {
		throw new Error("The usage export has no resource attributes.");
	}
	return [...keys];
}

/** The event name the usage export copies onto each log record. */
export function eventNameFrom(source: string): string {
	const match = /const EVENT_NAME = ["']([^"']+)["']/.exec(source);
	if (!match?.[1]) {
		throw new Error("The usage export does not name the event.");
	}
	return match[1];
}

/** Usage-event attribute keys, resource keys, and the event name. Sorted. */
export function usageExportKeys(sendSource: string): string[] {
	const keys = new Set<string>(resourceKeysFrom(sendSource));
	keys.add(eventNameFrom(sendSource));
	for (const schema of Object.values(usageEventSchema)) {
		for (const key of Object.keys(schema.shape)) {
			if (key !== "name") keys.add(key);
		}
	}
	return [...keys].sort();
}

function redactionOf(yaml: string): Redaction {
	let parsed: unknown;
	try {
		parsed = Bun.YAML.parse(yaml);
	} catch (error) {
		const message = error instanceof Error ? error.message : "parse error";
		throw new Error(`collector.yaml is not valid YAML. ${message}`);
	}
	if (!parsed || typeof parsed !== "object") {
		throw new Error("collector.yaml has no redaction processor.");
	}
	const redaction = (parsed as { processors?: { redaction?: unknown } })
		.processors?.redaction;
	if (!redaction || typeof redaction !== "object") {
		throw new Error("collector.yaml has no redaction processor.");
	}
	return redaction as Redaction;
}

/** Problems in one Collector config against one usage-export source. */
export function allowlistProblems(yaml: string, sendSource: string): string[] {
	let redaction: Redaction;
	try {
		redaction = redactionOf(yaml);
	} catch (error) {
		return [error instanceof Error ? error.message : "collector.yaml failed."];
	}
	const problems: string[] = [];
	if (redaction.allow_all_keys !== false) {
		problems.push("collector.yaml must set allow_all_keys to false.");
	}
	const listed = redaction.allowed_keys;
	if (
		!Array.isArray(listed) ||
		listed.some((key) => typeof key !== "string" || key === "")
	) {
		problems.push("collector.yaml has no redaction allowed_keys list.");
		return problems;
	}
	const expected = usageExportKeys(sendSource);
	const expectedSet = new Set(expected);
	const defined = new Set<string>(Object.keys(REGISTRY.attributes));
	defined.add(eventNameFrom(sendSource));
	const seen = new Set<string>();
	for (const key of listed) {
		if (seen.has(key)) {
			problems.push(`collector.yaml lists ${key} more than once.`);
			continue;
		}
		seen.add(key);
		if (!defined.has(key)) {
			problems.push(
				`collector.yaml allows ${key}. The registry does not define that key.`,
			);
			continue;
		}
		if (!expectedSet.has(key)) {
			problems.push(
				`collector.yaml allows ${key}. The usage export does not send that key.`,
			);
		}
	}
	for (const key of expected) {
		if (!seen.has(key)) {
			problems.push(
				`collector.yaml misses ${key}. The usage export sends that key.`,
			);
		}
	}
	return problems;
}

/** Problems for the Collector file in `root`. */
export function checkCollectorAllowlist(root: string): string[] {
	const sendSource = readFileSync(join(root, USAGE_SEND), "utf8");
	const yaml = readFileSync(join(root, COLLECTOR), "utf8");
	return allowlistProblems(yaml, sendSource);
}

if (import.meta.main) {
	const root = join(import.meta.dir, "..");
	const problems = checkCollectorAllowlist(root);
	if (problems.length > 0) {
		console.error("Collector allowlist check failed:\n");
		for (const problem of problems) console.error(`- ${problem}`);
		process.exit(1);
	}
	console.log("Collector allowlist check passed.");
}
