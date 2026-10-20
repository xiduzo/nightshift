/** What the Agents page shows on the right, and its `item` in the URL. */
import type { HarnessRowName } from "@/shared/api";
import { isHarnessName } from "./harnesses";

/** What the detail pane shows, as it sits in the URL (`?item=profile:builder`). */
export type Selection =
	| { kind: "profile"; name: string }
	| { kind: "new-profile" }
	| { kind: "harness"; name: HarnessRowName }
	| { kind: "tool"; name: string }
	| { kind: "cli"; name: string }
	| { kind: "secrets" };

export function parseItem(item: string | undefined): Selection | null {
	if (!item) return null;
	// A custom agent's name has a colon of its own: `harness:acp:goose`.
	const colon = item.indexOf(":");
	const kind = colon === -1 ? item : item.slice(0, colon);
	const name = colon === -1 ? "" : item.slice(colon + 1);
	switch (kind) {
		case "profile":
			return name ? { kind, name } : null;
		case "harness":
			return isHarnessName(name) ? { kind, name } : null;
		case "tool":
		case "cli":
			return name ? { kind, name } : null;
		case "new-profile":
		case "secrets":
			return { kind };
		default:
			return null;
	}
}

export function itemOf(selection: Selection): string {
	return "name" in selection
		? `${selection.kind}:${selection.name}`
		: selection.kind;
}
