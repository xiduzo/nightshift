import { NIGHT_SHIFT } from "../../../../contract";
import { saveCliTool } from "../../application/save-cli-tool";
import type { CliToolStore } from "../../wire";
import { inMemorySavedCliTools } from "./in-memory-saved-cli-tools";

/**
 * The CLI tools over in-memory adapters: the real use case behind the store.
 * The use-case test of every slice that reads or saves a CLI tool takes this
 * one. Test code: production code never imports this file.
 */
export function inMemoryCliTools() {
	const saved = inMemorySavedCliTools();
	const save = saveCliTool({ saved, now: () => 1 });
	const bound = {
		list: () =>
			[...saved.read().values()].sort((a, b) => a.name.localeCompare(b.name)),
		get: (name) => saved.read().get(name) ?? null,
		save: (input) => save(NIGHT_SHIFT, input),
		remove: (name) => saved.remove(name),
	} satisfies Partial<CliToolStore>;
	return { ...bound, saved };
}
