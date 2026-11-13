/**
 * The Settings page: an overview with one card for each part, and each
 * part its own page behind the breadcrumb and the sidebar menu. Night
 * Shift's agents get a table with a choice for each. Your agents, your
 * harnesses, models and tools are the lists of the agents vertical.
 */
import { BUILTIN_AGENTS } from "@nightshift/flows";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AgentsPage, profileQueries, SetupCard } from "@/features/agents";
import { NotificationSettingsCard } from "@/features/notifications";
import type { SettingsView } from "@/shared/api";
import {
	type Crumb,
	PageHeading,
	PageSection,
	SiteHeader,
} from "@/shared/page";
import type { AgentPicker } from "./answers-table";
import { BuiltinAgentDetail, BuiltinAgentsTable } from "./builtin-agents";
import { AgentDefaultsCard } from "./components/agent-defaults-card";
import { AppearanceCard } from "./components/appearance-card";
import { CleanupCard } from "./components/cleanup-card";
import { MeaningSearchCard } from "./components/meaning-search-card";
import { MonitoringCard } from "./components/monitoring-card";
import { PhoneCard } from "./components/phone-card";
import { RunPolicyCard } from "./components/run-policy-card";
import { RunsCard } from "./components/runs-card";
import { NewNodesTable, SearchTable } from "./new-defaults";
import { settingsQueries } from "./queries";
import {
	AGENTS_PARTS,
	SECTIONS,
	type Section,
	type SettingsSearch,
} from "./sections";

export function SettingsPage({
	search,
	onSelect,
	thisComputer,
	agentPicker,
}: {
	search: SettingsSearch;
	/** Opens an item of a list of your agents, or closes it. */
	onSelect: (item: string | undefined) => void;
	/** The section of this computer, which the Devices vertical owns. */
	thisComputer: ReactNode;
	/** The agent picker of the chat, which the flows vertical owns. */
	agentPicker: AgentPicker;
}) {
	const current = SECTIONS.find((item) => item.key === search.section);
	const builtin =
		current?.key === "builtin"
			? BUILTIN_AGENTS.find((agent) => agent.id === search.agent)
			: undefined;
	const settings = useQuery(settingsQueries.get());
	const data = settings.data;

	/** The breadcrumb of a page. `last`: the page is the last step, with the menu of the pages. */
	const sectionCrumbs = (section: Section, last: boolean): Crumb[] => [
		{ label: "Settings", link: { to: "/settings", search: {} } },
		last
			? {
					label: section.label,
					menu: SECTIONS.map((item) => ({
						label: item.label,
						icon: item.icon,
						link: { to: "/settings", search: { section: item.key } },
						current: item.key === section.key,
					})),
				}
			: {
					label: section.label,
					link: { to: "/settings", search: { section: section.key } },
				},
	];

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
				partCrumbs={sectionCrumbs(current, true)}
				after={
					data && current.key === "agents" ? (
						<AgentDefaultsCard data={data} />
					) : data && current.key === "models" ? (
						<MeaningSearchCard data={data} />
					) : null
				}
				heading={
					<PageHeading title={current.label} description={current.line} />
				}
			/>
		);
	}

	/** The parts of a page that read the settings: they wait for them, and say when they did not load. */
	const withSettings = (render: (data: SettingsView) => ReactNode) =>
		data ? (
			render(data)
		) : settings.error ? (
			<Alert variant="destructive">
				<CircleAlertIcon />
				<AlertTitle>The settings did not load</AlertTitle>
				<AlertDescription>{settings.error.message}</AlertDescription>
				<AlertAction>
					<Button
						variant="outline"
						size="sm"
						disabled={settings.isFetching}
						onClick={() => void settings.refetch()}
					>
						{settings.isFetching ? <Spinner data-icon="inline-start" /> : null}
						Try again
					</Button>
				</AlertAction>
			</Alert>
		) : (
			<Skeleton className="h-56 w-full rounded-xl" />
		);

	return (
		<>
			<SiteHeader
				crumbs={
					!current
						? [{ label: "Settings" }]
						: builtin
							? [...sectionCrumbs(current, false), { label: builtin.name }]
							: sectionCrumbs(current, true)
				}
			/>
			<div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-4 md:p-6">
				{builtin ? (
					<>
						<PageHeading title={builtin.name} description={builtin.job} />
						<BuiltinAgentDetail agent={builtin} agentPicker={agentPicker} />
					</>
				) : !current ? (
					<Overview />
				) : current.key === "builtin" ? (
					<>
						<PageHeading title={current.label} description={current.line} />
						<BuiltinAgentsTable agentPicker={agentPicker} />
						<PageSection
							title="New nodes"
							description="What a new node starts with. Existing nodes keep their values."
						>
							{withSettings((view) => (
								<NewNodesTable data={view} agentPicker={agentPicker} />
							))}
						</PageSection>
						<PageSection
							title="Search"
							description="Search finds files by what they mean, not only by their words."
						>
							{withSettings((view) => (
								<SearchTable data={view} agentPicker={agentPicker} />
							))}
						</PageSection>
					</>
				) : current.key === "runs" ? (
					<>
						<PageHeading title={current.label} description={current.line} />
						{withSettings((view) => (
							<>
								<RunsCard data={view} />
								<RunPolicyCard data={view} />
								<CleanupCard data={view} />
							</>
						))}
					</>
				) : current.key === "computer" ? (
					<>
						<PageHeading title={current.label} description={current.line} />
						{thisComputer}
						<PhoneCard />
						{withSettings((view) => (
							<MonitoringCard data={view} />
						))}
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

/** Settings with no page open: the setup of this computer, and one card for each page. */
function Overview() {
	const profiles = useQuery(profileQueries.agents());
	const count = profiles.data?.length;
	const line = (section: Section) =>
		section.key === "builtin"
			? `${BUILTIN_AGENTS.length} agents. ${section.line}`
			: section.key === "agents" && count !== undefined
				? `${count} ${count === 1 ? "profile" : "profiles"}. ${section.line}`
				: section.line;
	return (
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
								<CardDescription>{line(item)}</CardDescription>
							</CardHeader>
						</Card>
					</Link>
				))}
			</div>
		</>
	);
}
