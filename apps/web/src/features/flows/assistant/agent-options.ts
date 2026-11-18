import { type BuiltinAgentId, harnessTakesTools } from "@nightshift/flows";
import { useQuery } from "@tanstack/react-query";
import {
	type HarnessName,
	harnessInfo,
	harnessQueries,
	profileQueries,
	useCustomAgents,
} from "@/features/agents";
import { settingsQueries } from "@/features/settings";
import type { AgentProfileRow } from "@/shared/api";
import type { AgentChoice } from "./agent-choice";

/**
 * What the agent is for: the chat needs a harness that can use its tools.
 * A run has no profile for help: it names its own agent.
 */
export type AgentPurpose = "suggest" | "chat" | "run";

/** The default that answers when the person picks nothing here. */
export type DefaultAnswer = {
	/** The built-in agent whose Settings page holds the default. */
	agent: BuiltinAgentId;
	/** What answers by default: "opus", "Claude Code · sonnet". */
	label: string;
	/** Nothing is picked here: the default answers. */
	active: boolean;
	/** Goes back to the default. */
	onPick: () => void;
};

const quiet = { staleTime: 30_000, meta: { quietErrors: true } } as const;

/**
 * The profiles and harnesses of this computer, and the profile the
 * settings' "Profile for help" resolves to, as the daemon picks it: the
 * setting, else the first profile on a harness that is added. For the
 * chat, only one that can chat counts.
 */
export function useAgentOptions(purpose: AgentPurpose) {
	const profiles = useQuery({ ...profileQueries.agents(), ...quiet });
	const harnesses = useQuery({ ...harnessQueries.list(), ...quiet });
	const settings = useQuery({ ...settingsQueries.get(), ...quiet });
	const customAgents = useCustomAgents();
	const added = (harnesses.data ?? []).filter((h) => h.added);
	const fits = (harness: HarnessName) =>
		purpose !== "chat" || harnessTakesTools(harness);
	const list = profiles.data ?? [];
	const setting = settings.data?.values.assistantProfile?.trim() ?? "";
	const fromSetting = list.find((p) => p.name === setting);
	const forHelp =
		fromSetting && fits(fromSetting.harness)
			? fromSetting
			: list.find(
					(p) => added.some((h) => h.name === p.harness) && fits(p.harness),
				);
	return {
		profiles: list,
		harnesses: added,
		forHelp,
		fits,
		info: (name: HarnessName) => harnessInfo(name, customAgents),
	};
}

export type Options = ReturnType<typeof useAgentOptions>;

/** What the menus show for a choice: the profile in use, the harness, model and effort that answer. */
export function resolve(choice: AgentChoice, options: Options) {
	const none = choice.profile === undefined && choice.harness !== undefined;
	const usesHelp = choice.profile === undefined && !none;
	const profile: AgentProfileRow | undefined = usesHelp
		? options.forHelp
		: options.profiles.find((p) => p.name === choice.profile);
	const harness: HarnessName =
		choice.harness ??
		profile?.harness ??
		options.harnesses[0]?.name ??
		"claude-code";
	const model =
		choice.model ??
		(none ? options.info(harness).defaultModel : (profile?.model ?? ""));
	const effort = choice.effort ?? (none ? undefined : profile?.effort);
	return {
		none,
		usesHelp,
		profile,
		harness,
		model,
		effort,
		// The profile for help, and there is none: only a harness and model can answer.
		locked: usesHelp && !options.forHelp,
	};
}

/** The trigger's words: "Profile for help", "worker · haiku", "Claude Code · haiku". */
export function choiceLabel(
	choice: AgentChoice,
	info: (name: HarnessName) => { label: string },
): string {
	const parts =
		choice.profile !== undefined
			? [
					choice.profile,
					choice.harness ? info(choice.harness).label : null,
					choice.model,
				]
			: choice.harness !== undefined
				? [info(choice.harness).label, choice.model]
				: ["Profile for help"];
	return parts.filter(Boolean).join(" · ");
}

/** Why the chat cannot run on the choice, or null. */
export function chatRefusal(
	choice: AgentChoice,
	purpose: AgentPurpose,
	options: Options,
): string | null {
	if (purpose !== "chat") return null;
	const profile =
		choice.profile !== undefined
			? options.profiles.find((p) => p.name === choice.profile)
			: choice.harness === undefined
				? options.forHelp
				: undefined;
	const harness = choice.harness ?? profile?.harness;
	if (harness === undefined || options.fits(harness)) return null;
	return `${options.info(harness).label} cannot read your flow or propose changes. Choose Claude Code, Codex or OpenCode.`;
}

/** The harnesses the menu offers: the added ones, and the chosen one when it is not added. */
export function harnessList(choice: AgentChoice, options: Options) {
	const list = options.harnesses.map((h) => ({ name: h.name, added: true }));
	if (choice.harness && !list.some((h) => h.name === choice.harness))
		list.push({ name: choice.harness, added: false });
	return list;
}
