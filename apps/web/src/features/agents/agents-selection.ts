/** What a page of the agents shows in detail, and its `item` in the URL. */
import type { HarnessRowName } from "@/shared/api";
import { isHarnessName } from "./harnesses";

/** What the detail pane shows, as it sits in the URL (`?item=profile:<id>`). */
export type Selection =
	| { kind: "profile"; id: string }
	| { kind: "new-profile" }
	| { kind: "new-model-profile" }
	| { kind: "harness"; name: HarnessRowName }
	| { kind: "tool"; name: string }
	| { kind: "cli"; name: string }
	| { kind: "device"; id: string };

export function parseItem(item: string | undefined): Selection | null {
	if (!item) return null;
	// A custom agent's name has a colon of its own: `harness:acp:goose`.
	const colon = item.indexOf(":");
	const kind = colon === -1 ? item : item.slice(0, colon);
	const name = colon === -1 ? "" : item.slice(colon + 1);
	switch (kind) {
		case "profile":
		case "device":
			return name ? { kind, id: name } : null;
		case "harness":
			return isHarnessName(name) ? { kind, name } : null;
		case "tool":
		case "cli":
			return name ? { kind, name } : null;
		case "new-profile":
		case "new-model-profile":
			return { kind };
		default:
			return null;
	}
}

/** The lists of the agents. Each is a page of Settings. */
export type AgentsPartName = "profiles" | "models" | "harnesses" | "tools";

/**
 * The list that `item` belongs to: the page of Settings that opens it. A
 * profile opens with the Agent Profiles: its item does not say its kind.
 */
export function agentsPartOfItem(item: string | undefined): AgentsPartName {
	switch (parseItem(item)?.kind) {
		case "new-model-profile":
			return "models";
		case "harness":
			return "harnesses";
		case "tool":
		case "cli":
			return "tools";
		default:
			return "profiles";
	}
}

export function itemOf(selection: Selection): string {
	if ("id" in selection) return `${selection.kind}:${selection.id}`;
	return "name" in selection
		? `${selection.kind}:${selection.name}`
		: selection.kind;
}
