import {
	HARNESS_CATALOG,
	type HarnessName,
	isAgentProfile,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { ProfileView } from "./profile-edits";

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

/** What this computer has set up, as the search for programs reads it. */
export type SetUpFacts = {
	/** The program a harness's setting names (`claudeBin`). */
	bin(harness: HarnessName): string;
	profiles: readonly ProfileView[];
	/** The programs the CLI tools run. */
	toolPrograms: readonly string[];
};

/** Where a program is on this computer, or null. */
export type Which = (program: string) => string | null;

export function notFound(program: string): string {
	return `Night Shift does not find ${program} on this computer, or it is set up already.`;
}

/** The programs found on this computer that are not set up yet: agents first. */
export function foundPrograms(facts: SetUpFacts, which: Which): FoundProgram[] {
	const profiled = new Set(
		facts.profiles.flatMap((p) => (isAgentProfile(p) ? [p.harness] : [])),
	);
	const agents = AGENT_HARNESSES.flatMap((harness): FoundProgram[] => {
		const program = facts.bin(harness);
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
	const tooled = new Set(facts.toolPrograms);
	const tools = Object.entries(TOOL_PROGRAMS).flatMap(
		([program, label]): FoundProgram[] =>
			tooled.has(program) || which(program) === null
				? []
				: [{ kind: "tool", program, label }],
	);
	return [...agents, ...tools];
}

/** The found program a person asks to set up. Refused when it is not found, or is set up already. */
export function programToSetUp(
	found: readonly FoundProgram[],
	program: string,
): FoundProgram {
	const chosen = found.find((candidate) => candidate.program === program);
	if (!chosen) throw new Refusal("conflict", notFound(program));
	return chosen;
}
