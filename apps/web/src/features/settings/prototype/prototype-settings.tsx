/**
 * PROTOTYPE, throw away. Settings as an overview with one card for each
 * part, and each part its own page behind the breadcrumb and the sidebar
 * menu. Night Shift's agents get a table with a choice for each. Your
 * agents, your harnesses, models and tools are the parts of the Agents
 * page, as they are. The choices for Night Shift's agents stay in this
 * tab: nothing is saved.
 */
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	BotIcon,
	ChevronRightIcon,
	CpuIcon,
	MonitorIcon,
	PlayIcon,
	SparklesIcon,
	TerminalIcon,
	UserIcon,
	WrenchIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
	AgentsPage,
	type AgentsPart,
	profileQueries,
	SetupCard,
} from "@/features/agents";
import { NotificationSettingsCard } from "@/features/notifications";
import { type Crumb, PageHeading, SiteHeader } from "@/shared/page";
import { AgentDefaultsCard } from "../components/agent-defaults-card";
import { AppearanceCard } from "../components/appearance-card";
import { CleanupCard } from "../components/cleanup-card";
import { MeaningSearchCard } from "../components/meaning-search-card";
import { MonitoringCard } from "../components/monitoring-card";
import { PhoneCard } from "../components/phone-card";
import { RunPolicyCard } from "../components/run-policy-card";
import { RunsCard } from "../components/runs-card";
import { settingsQueries } from "../queries";
import {
	type AgentPicker,
	BuiltinDetail,
	BuiltinTable,
	useChoices,
} from "./builtin-agents";
import { BUILTINS, builtinOf } from "./model";

export type ProtoSearch = {
	section?: string;
	agent?: string;
	item?: string;
};

const SECTIONS = [
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

type SectionKey = (typeof SECTIONS)[number]["key"];

/** The parts that are the Agents page, as it is. */
const AGENTS_PARTS: Partial<Record<SectionKey, AgentsPart["only"]>> = {
	agents: "profiles",
	harnesses: "harnesses",
	models: "models",
	tools: "tools",
};

export function PrototypeSettings({
	search,
	onSelect,
	thisComputer,
	agentPicker,
}: {
	search: ProtoSearch;
	/** Opens an item of a part, or closes it. */
	onSelect: (item: string | undefined) => void;
	thisComputer: ReactNode;
	agentPicker: AgentPicker;
}) {
	const current = SECTIONS.find((item) => item.key === search.section);
	const builtin = current?.key === "builtin" ? builtinOf(search.agent) : null;
	const settings = useQuery(settingsQueries.get());
	const profiles = useQuery(profileQueries.agents());
	const choices = useChoices();
	const data = settings.data;

	const sectionCrumb = (last: boolean): Crumb[] =>
		current
			? [
					{ label: "Settings", link: { to: "/settings", search: {} } },
					last
						? {
								label: current.label,
								menu: SECTIONS.map((item) => ({
									label: item.label,
									icon: item.icon,
									link: { to: "/settings", search: { section: item.key } },
									current: item.key === current.key,
								})),
							}
						: {
								label: current.label,
								link: { to: "/settings", search: { section: current.key } },
							},
				]
			: [{ label: "Settings" }];

	const part = current ? AGENTS_PARTS[current.key] : undefined;
	if (current && part) {
		return (
			<AgentsPage
				item={search.item}
				onSelect={onSelect}
				part={{
					only: part,
					search: (item) => ({
						section: current.key,
						...(item ? { item } : {}),
					}),
				}}
				partCrumbs={sectionCrumb(true)}
				heading={
					<div className="mx-auto w-full max-w-4xl px-4 pt-4 md:px-6 md:pt-6">
						<PageHeading title={current.label} description={current.line} />
					</div>
				}
			/>
		);
	}

	return (
		<>
			<SiteHeader
				crumbs={
					builtin
						? [...sectionCrumb(false), { label: builtin.name }]
						: sectionCrumb(true)
				}
			/>
			<div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-4 md:p-6">
				{builtin ? (
					<>
						<PageHeading title={builtin.name} description={builtin.job} />
						<BuiltinDetail
							builtin={builtin}
							choices={choices}
							agentPicker={agentPicker}
						/>
					</>
				) : !current ? (
					<>
						<PageHeading
							title="Settings"
							description="Choose who answers, how flows run and how Night Shift tells you."
						/>
						<SetupCard always />
						<div className="grid gap-4 sm:grid-cols-2">
							{SECTIONS.map((item) => (
								<Link
									key={item.key}
									to="/settings"
									search={{ section: item.key }}
									className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<Card size="sm" className="h-full hover:bg-muted/50">
										<CardHeader>
											<CardTitle className="flex items-center gap-2">
												<item.icon className="size-4 text-muted-foreground" />
												{item.label}
												<ChevronRightIcon className="ml-auto size-4 text-muted-foreground" />
											</CardTitle>
											<CardDescription>
												{item.key === "builtin"
													? `${BUILTINS.length} agents. ${item.line}`
													: item.key === "agents" && profiles.data
														? `${profiles.data.length} ${profiles.data.length === 1 ? "profile" : "profiles"}. ${item.line}`
														: item.line}
											</CardDescription>
										</CardHeader>
									</Card>
								</Link>
							))}
						</div>
					</>
				) : current.key === "builtin" ? (
					<>
						<PageHeading title={current.label} description={current.line} />
						<BuiltinTable
							choices={choices}
							agentPicker={agentPicker}
							searchOf={(agent) => ({ section: "builtin", agent })}
						/>
						{data ? <AgentDefaultsCard data={data} /> : null}
						{data ? <MeaningSearchCard data={data} /> : null}
					</>
				) : current.key === "runs" ? (
					<>
						<PageHeading title={current.label} description={current.line} />
						{data ? (
							<>
								<RunsCard data={data} />
								<RunPolicyCard data={data} />
								<CleanupCard data={data} />
							</>
						) : null}
					</>
				) : current.key === "computer" ? (
					<>
						<PageHeading title={current.label} description={current.line} />
						{thisComputer}
						<PhoneCard />
						{data ? <MonitoringCard data={data} /> : null}
					</>
				) : (
					<>
						<PageHeading title={current.label} description={current.line} />
						<NotificationSettingsCard />
						<AppearanceCard />
					</>
				)}
			</div>
		</>
	);
}
