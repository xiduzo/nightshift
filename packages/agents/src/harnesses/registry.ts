/**
 * The harness registry: one record per harness, from its own folder
 * (`<harness>/record.ts`). Every harness an Agent node can run on. The
 * first four are TanStack AI harness adapters (packages tagged `harness`).
 * The others speak ACP and run through `@tanstack/ai-acp` (see `acp/`).
 * The other `@tanstack/ai-*` adapters (Anthropic, OpenAI, Ollama, …) are
 * chat adapters: they cannot run tools in a worktree, so they cannot run
 * an Agent node.
 *
 * Add a harness: a folder with its `facts.ts`, `record.ts` and harness,
 * one line here, one line in `facts.ts`, and its name in `@nightshift/flows`
 * (`harnessNameSchema`). The `Record<HarnessName, …>` types fail until all
 * are there.
 */
import {
	baseCheck,
	type CliCheck,
	firstLine,
	probe,
	resolveBin,
} from "../doctor";
import type { HarnessName } from "../port";
import { ACP_ADAPTERS } from "./acp/record";
import { CLAUDE_CODE_ADAPTER } from "./claude-code/record";
import { CODEX_ADAPTER } from "./codex/record";
import { GROK_BUILD_ADAPTER } from "./grok-build/record";
import type { HarnessAdapter } from "./harness-record";
import { OPENCODE_ADAPTER } from "./opencode/record";

export const HARNESS_ADAPTERS: Record<HarnessName, HarnessAdapter> = {
	"claude-code": CLAUDE_CODE_ADAPTER,
	opencode: OPENCODE_ADAPTER,
	codex: CODEX_ADAPTER,
	"grok-build": GROK_BUILD_ADAPTER,
	...ACP_ADAPTERS,
};

/** The version, and the login where the CLI can tell. Others: version only. */
export async function checkHarness(
	harness: HarnessName,
	bin: string,
): Promise<CliCheck> {
	const adapter = HARNESS_ADAPTERS[harness];
	if (adapter.check) return adapter.check(bin);
	const { resolved: _resolved, ...check } = await baseCheck(bin, adapter.label);
	return check;
}

export type HarnessModels = {
	/** The adapter's models, then the ones only the CLI listed. */
	models: string[];
	/** How many of `models` came from the CLI's listing and not the adapter. */
	listed: number;
	/** Why the CLI's listing did not answer. Null when it did, or when it has none. */
	problem: string | null;
	checkedAt: number;
};

/**
 * The models a harness offers: the adapter's list, plus what the CLI lists
 * itself when it can (`opencode models`: one `provider/model` per line).
 * Never throws: a CLI that cannot answer leaves the adapter's list, so the
 * picker is never empty.
 */
export async function harnessModels(
	harness: HarnessName,
	bin: string,
): Promise<HarnessModels> {
	const adapter = HARNESS_ADAPTERS[harness];
	const known = [...adapter.models];
	const result = (listedModels: string[], problem: string | null) => {
		const extra = listedModels.filter((m) => !known.includes(m));
		return {
			models: [...known, ...extra],
			listed: extra.length,
			problem,
			checkedAt: Date.now(),
		};
	};
	if (!adapter.listing) return result([], null);
	const path = await resolveBin(bin);
	if (!path) return result([], `Night Shift cannot find ${bin}.`);
	try {
		const out = await probe([path, ...adapter.listing]);
		if (out.code !== 0) {
			return result(
				[],
				firstLine(out.stderr) ?? "Night Shift could not list the models.",
			);
		}
		const listed = adapter.parseListing
			? adapter.parseListing(out)
			: out.stdout
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line.includes("/") && !/\s/.test(line));
		return result([...new Set(listed)], null);
	} catch (error) {
		return result([], String(error));
	}
}
