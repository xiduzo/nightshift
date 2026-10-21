import type { JsonValue } from "@nightshift/flows";

import type { EngineEventType, ItemFacts, Scope } from "./events";

type Raw = Record<string, unknown>;

/**
 * Reads payloads written before flow format 2 in today's shape: a scope
 * `{ forEachStepId, itemId }` becomes `{ parentStepId, itemId }`, and the
 * item facts of a GitHub issue (`number`, `body`, `parentNumber`, …) become
 * an element `value`. The log itself is never rewritten.
 */
export function upgradePayload(type: EngineEventType, payload: Raw): Raw {
	if (!payload || typeof payload !== "object") return payload;
	if (
		(type === "StepStarted" || type === "RunResumed" || type === "EdgeTaken") &&
		payload.scope
	) {
		return { ...payload, scope: upgradeScope(payload.scope as Raw) };
	}
	if ((type === "ItemStarted" || type === "ItemBlocked") && payload.item) {
		return { ...payload, item: upgradeItemFacts(payload.item as Raw) };
	}
	return payload;
}

function upgradeScope(scope: Raw): Scope {
	if (typeof scope.parentStepId === "string") return scope as Scope;
	return {
		parentStepId: String(scope.forEachStepId),
		itemId: typeof scope.itemId === "string" ? scope.itemId : null,
	};
}

function upgradeItemFacts(item: Raw): ItemFacts {
	if (Object.hasOwn(item, "value")) return item as ItemFacts;
	const value: Record<string, JsonValue> = {};
	const keep = (key: string, from: unknown) => {
		if (from !== null && from !== undefined) value[key] = from as JsonValue;
	};
	keep("id", item.id);
	keep("number", item.number);
	keep("title", item.title);
	keep("body", item.body);
	keep("url", item.url);
	if (item.parentNumber != null || item.parentTitle != null) {
		const parent: Record<string, JsonValue> = {};
		if (item.parentNumber != null) parent.number = item.parentNumber as number;
		if (item.parentTitle != null) parent.title = item.parentTitle as string;
		value.parent = parent;
	}
	return {
		id: String(item.id),
		title: typeof item.title === "string" ? item.title : String(item.id),
		url: typeof item.url === "string" ? item.url : null,
		value,
	};
}
