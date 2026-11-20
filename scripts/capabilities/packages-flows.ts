import type { Place } from "../capabilities";
import { MECHANISM as M } from "./kinds";

/** The verticals of `packages/flows` (`scripts/capabilities.ts` says how to place one). */
export const PACKAGE_FLOWS: Record<string, Place> = {
	// The flow format is the language every capability speaks (the kernel
	// of the hexagon series). Its parts are mechanisms: the schema
	// (`flow`), the node types, templates, shapes, the checks of a flow,
	// and the flows that ship (`kits`, `starters`). The capability `flows`
	// is what a Project does with its flows.
	assistant: "assistant",
	// The built-in agents, and who answers for each.
	builtin: "assistant",
	// The edits of the flow editor on its draft.
	draft: "flows",
	flow: M,
	// The built-in harnesses as a person sees them.
	harnesses: "agents",
	kits: M,
	lists: M,
	nodes: M,
	presets: M,
	// Agent Profiles and Model Profiles.
	profiles: "agents",
	recipes: M,
	schedules: "schedules",
	secrets: "secrets",
	sections: M,
	shapes: M,
	starters: M,
	template: M,
	// The checks of a whole flow: its names, edges, loops, references and
	// calls. They are the grammar of the format, and they hold for a flow
	// of any Project. So `validate` is a mechanism and not a part of the
	// capability `flows`, which is what a Project does with its flows.
	validate: M,
};
