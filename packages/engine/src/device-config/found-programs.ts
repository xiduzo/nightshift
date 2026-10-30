import {
	HARNESS_CATALOG,
	type HarnessName,
	isAgentProfile,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

import { programOf } from "./cli-tools";
import type { ConfigStores } from "./config-stores";
import { addHarness, saveProfile } from "./edits";
import { HARNESS_BIN } from "./settings";

/**
 * The programs Night Shift knows how to use, found on this computer and not
 * set up yet: the agent CLIs (an Agent Profile on their harness) and the
 * CLI tools its kits run. The Agents page offers to set each one up with
 * one action. Only reads, until a person asks for one.
 */

/** The harnesses whose CLI Night Shift looks for, in the order it offers them. */
const AGENT_HARNESSES = [
	"claude-code",
	"codex",
	"opencode",
	"pi",
] as const satisfies readonly HarnessName[];

/** The CLI tools the kits run, with what a person calls them. */
const TOOL_PROGRAMS: Readonly<Record<string, string>> = {
	gh: "GitHub CLI",
	acli: "Atlassian CLI",
};

/** A program found on this computer that is not set up yet. */
export type FoundProgram =
	| {
			kind: "agent";
			/** The program, as the harness's setting names it (`claude`). */
			program: string;
			harness: HarnessName;
			label: string;
	  }
	| { kind: "tool"; program: string; label: string };

/** What setting up a found program made: the profile, or the CLI tool. */
export type SetUpProgram =
	| { kind: "agent"; profileId: string; name: string }
	| { kind: "tool"; name: string };

type Stores = Pick<
	ConfigStores,
	"settings" | "profiles" | "cliTools" | "connections"
>;

/** Where a program is on this computer, or null. */
type Which = (program: string) => string | null;

const bunWhich: Which = (program) => Bun.which(program);

/** The programs found on this computer that are not set up yet: agents first. */
export function foundPrograms(
	stores: Stores,
	which: Which = bunWhich,
): FoundProgram[] {
	const settings = stores.settings.current();
	const profiled = new Set(
		stores.profiles
			.list()
			.flatMap((p) => (isAgentProfile(p) ? [p.harness] : [])),
	);
	const agents = AGENT_HARNESSES.flatMap((harness): FoundProgram[] => {
		const program = String(settings[HARNESS_BIN[harness]]);
		if (profiled.has(harness) || which(program) === null) return [];
		return [
			{
				kind: "agent",
				program,
				harness,
				label: HARNESS_CATALOG[harness].label,
			},
		];
	});
	const tooled = new Set(stores.cliTools.list().map(programOf));
	const tools = Object.entries(TOOL_PROGRAMS).flatMap(
		([program, label]): FoundProgram[] =>
			tooled.has(program) || which(program) === null
				? []
				: [{ kind: "tool", program, label }],
	);
	return [...agents, ...tools];
}

/**
 * Sets up one found program. An agent CLI: its harness is added, and an
 * Agent Profile on it, named after the program, with the harness's default
 * model and the night's permission mode. A CLI tool: a tool of its name.
 * Refused for a program that is not found, or is set up already.
 */
export async function setUpProgram(
	stores: Stores,
	program: string,
	which: Which = bunWhich,
): Promise<SetUpProgram> {
	const found = foundPrograms(stores, which).find(
		(candidate) => candidate.program === program,
	);
	if (!found) {
		throw new Refusal(
			"conflict",
			`Night Shift does not find ${program} on this computer, or it is set up already.`,
		);
	}
	if (found.kind === "tool") {
		const tool = await stores.cliTools.save({ name: found.program });
		return { kind: "tool", name: tool.name };
	}
	await addHarness(stores, found.harness);
	const profile = await saveProfile(stores, {
		name: freeProfileName(stores, found.program),
		harness: found.harness,
		model: HARNESS_CATALOG[found.harness].defaultModel,
		permissionMode: stores.settings.current().agentPermissionMode,
		clis: [],
		connections: [],
	});
	return { kind: "agent", profileId: profile.id, name: profile.name };
}

/** A profile name from the program's file name (`claude`), with a number when it is taken. */
function freeProfileName(
	stores: Pick<Stores, "profiles">,
	program: string,
): string {
	const file = program.split(/[\\/]/).at(-1) ?? program;
	const base =
		file
			.toLowerCase()
			.replace(/[^a-z0-9_]/g, "_")
			.replace(/^[^a-z]+/, "")
			.slice(0, 36) || "agent";
	if (!stores.profiles.byName(base)) return base;
	for (let n = 2; n < 100; n++) {
		const name = `${base}_${n}`;
		if (!stores.profiles.byName(name)) return name;
	}
	throw new Refusal(
		"conflict",
		`Every profile name for ${base} is taken. Add the profile yourself.`,
	);
}
