/** The pages of Settings: one for each part, behind the overview and the breadcrumb menu. */
import {
	BotIcon,
	CpuIcon,
	MonitorIcon,
	PlayIcon,
	SparklesIcon,
	TerminalIcon,
	UserIcon,
	WrenchIcon,
} from "lucide-react";
import { type AgentsPart, agentsPartOfItem } from "@/features/agents";

/**
 * The search of the Settings route. `section`: the page, none for the
 * overview. `agent`: one of Night Shift's agents, on its own page. `item`:
 * what a list of your agents shows in detail, for example
 * `harness:claude-code`.
 */
export type SettingsSearch = {
	section?: string;
	agent?: string;
	item?: string;
};

export const SECTIONS = [
	{
		key: "builtin",
		label: "Night Shift's agents",
		icon: SparklesIcon,
		line: "Six agents help you build, explain and decide. Choose who answers for each.",
	},
	{
		key: "agents",
		label: "Your agents",
		icon: BotIcon,
		line: "Profiles do the work of a step. A flow picks one by its name.",
	},
	{
		key: "harnesses",
		label: "Your harnesses",
		icon: TerminalIcon,
		line: "The programs an agent runs on, such as Claude Code or Codex.",
	},
	{
		key: "models",
		label: "Models",
		icon: CpuIcon,
		line: "Models that give one answer: to decide in a run and for short answers.",
	},
	{
		key: "tools",
		label: "Tools",
		icon: WrenchIcon,
		line: "The programs and connections a profile gives its agent.",
	},
	{
		key: "runs",
		label: "Runs",
		icon: PlayIcon,
		line: "Schedules, how many runs at once, limits, cleanup.",
	},
	{
		key: "computer",
		label: "This computer",
		icon: MonitorIcon,
		line: "Data folder, Host, network, phone, monitoring.",
	},
	{
		key: "you",
		label: "You",
		icon: UserIcon,
		line: "Notifications and appearance.",
	},
] as const;

export type Section = (typeof SECTIONS)[number];
export type SectionKey = Section["key"];

/** The pages that are a list of your agents, and the list each shows. */
export const AGENTS_PARTS: Partial<Record<SectionKey, AgentsPart["only"]>> = {
	agents: "profiles",
	harnesses: "harnesses",
	models: "models",
	tools: "tools",
};

/**
 * The Settings page that shows an item of your agents, for a link that
 * names only the item. No item: the page of your profiles.
 */
export function settingsSearchOfAgents(item?: string): SettingsSearch {
	const part = agentsPartOfItem(item);
	const section = SECTIONS.find((one) => AGENTS_PARTS[one.key] === part);
	return {
		...(section ? { section: section.key } : {}),
		...(item ? { item } : {}),
	};
}
