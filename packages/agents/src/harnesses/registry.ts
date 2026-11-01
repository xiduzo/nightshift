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
	type CustomAgent,
	customHarnessName,
	harnessNameSchema,
} from "@nightshift/flows";
import { now } from "@nightshift/time";
import {
	baseCheck,
	type CliCheck,
	firstLine,
	probe,
	resolveBin,
} from "../doctor";
import type { AgentHarnessName, HarnessName } from "../port";
import { ACP_DEFAULT_MODEL } from "./acp/facts";
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
			checkedAt: now(),
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

/**
 * A harness an Agent node can run on, as the Agents page lists it: a
 * built-in harness or a custom agent. `Setting` and `Source` are the
 * caller's: the setting that holds a built-in harness's executable, and
 * where its value comes from.
 */
export type HarnessView<Setting, Source> = {
	name: AgentHarnessName;
	label: string;
	initials: string;
	/** The `@tanstack/ai-*` package that runs it. */
	pkg: string;
	note: string;
	/** Where prompts and code go, for a harness that sends them off this computer. */
	offMachine: string;
	defaultModel: string;
	models: string[];
	/** The command that lists the CLI's own models. Null when it has none. */
	listing: string | null;
	/** It is added on this computer. A custom agent always is. */
	added: boolean;
	/** The executable: a built-in harness's setting, or a custom agent's command. */
	bin: string;
	binSetting: Setting | null;
	binSource: Source | null;
	/** The Agent Profiles that run on it. */
	profiles: string[];
	/** The custom agent itself. Null for a built-in harness. */
	custom: CustomAgent | null;
};

/**
 * Every harness an Agent node can run on: each built-in harness, and which
 * of them are added on this computer, then the custom agents (any ACP agent
 * a person added with its command).
 */
export function harnessViews<Setting, Source>(input: {
	/** The built-in harnesses added on this computer. */
	added: readonly HarnessName[];
	customAgents: readonly CustomAgent[];
	/** A built-in harness's executable, its setting, and where its value comes from. */
	bin(name: HarnessName): { bin: string; setting: Setting; source: Source };
	/** The names of the Agent Profiles that run on a harness. */
	profilesOn(name: AgentHarnessName): string[];
}): HarnessView<Setting, Source>[] {
	const builtIn = harnessNameSchema.options.map(
		(name): HarnessView<Setting, Source> => {
			const adapter = HARNESS_ADAPTERS[name];
			const bin = input.bin(name);
			return {
				name,
				label: adapter.label,
				initials: adapter.initials,
				pkg: adapter.pkg,
				note: adapter.note,
				offMachine: adapter.offMachine,
				defaultModel: adapter.defaultModel,
				models: [...adapter.models],
				listing: adapter.listing
					? [adapter.bin, ...adapter.listing].join(" ")
					: null,
				added: input.added.includes(name),
				bin: bin.bin,
				binSetting: bin.setting,
				binSource: bin.source,
				profiles: input.profilesOn(name),
				custom: null,
			};
		},
	);
	const custom = input.customAgents.map(
		(agent): HarnessView<Setting, Source> => ({
			name: customHarnessName(agent.slug),
			label: agent.label,
			initials: agent.label.slice(0, 2).toUpperCase(),
			pkg: "@tanstack/ai-acp",
			note: `Model default: the model set in ${agent.label}. You can type another model it offers.`,
			offMachine: `Prompts and code go wherever ${agent.label} sends them.`,
			defaultModel: ACP_DEFAULT_MODEL,
			models: [ACP_DEFAULT_MODEL],
			listing: null,
			added: true,
			bin: agent.command,
			binSetting: null,
			binSource: null,
			profiles: input.profilesOn(customHarnessName(agent.slug)),
			custom: agent,
		}),
	);
	return [...builtIn, ...custom];
}
