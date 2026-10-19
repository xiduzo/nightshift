import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
} from "@nightshift/ui/components/sidebar";
import { useQuery } from "@tanstack/react-query";
import { Link, useMatchRoute } from "@tanstack/react-router";
import {
	BotIcon,
	CalendarClockIcon,
	ChevronRightIcon,
	FolderIcon,
	FolderOpenIcon,
	HistoryIcon,
	HouseIcon,
	InboxIcon,
	type LucideIcon,
	MonitorIcon,
	MonitorSmartphoneIcon,
	MoonIcon,
	PlusIcon,
	Settings2Icon,
	SunIcon,
	SunMoonIcon,
	UsersIcon,
	WorkflowIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
	type ComponentProps,
	type ReactNode,
	useEffect,
	useState,
} from "react";

import { AddProjectDialog } from "@/components/add-project-form";
import { describeRunStatuses, RunsDonut } from "@/components/runs-donut";
import { SpaceSwitcher } from "@/components/space-switcher";
import { useOpenGates } from "@/hooks/use-open-gates";
import { useProjectRuns } from "@/hooks/use-project-runs";
import type { Project } from "@/lib/api-types";
import { orpc } from "@/utils/orpc";

/** The app shell's sidebar, after the shadcn `sidebar-07` block. */
export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
	const matchRoute = useMatchRoute();
	const gates = useOpenGates();
	const open = gates.data?.length ?? 0;
	const projects = useQuery(orpc.projects.list.queryOptions());

	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<SpaceSwitcher />
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Overview</SidebarGroupLabel>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton
								tooltip="Home"
								isActive={Boolean(matchRoute({ to: "/" }))}
								render={<Link to="/" />}
							>
								<HouseIcon aria-hidden="true" />
								<span>Home</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								tooltip={open > 0 ? `Inbox, ${open} waiting` : "Inbox"}
								isActive={Boolean(matchRoute({ to: "/inbox" }))}
								render={<Link to="/inbox" />}
							>
								<InboxIcon aria-hidden="true" />
								<span>Inbox</span>
							</SidebarMenuButton>
							{open > 0 ? (
								<SidebarMenuBadge
									className="bg-status-waiting/15 text-status-waiting"
									aria-label={`${open} ${open === 1 ? "gate waits" : "gates wait"} for you`}
								>
									{open}
								</SidebarMenuBadge>
							) : null}
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								tooltip="Members"
								isActive={Boolean(matchRoute({ to: "/members" }))}
								render={<Link to="/members" />}
							>
								<UsersIcon aria-hidden="true" />
								<span>Members</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
				<NavProjects projects={projects.data} />
				<SidebarGroup className="mt-auto">
					<SidebarGroupLabel>This Mac</SidebarGroupLabel>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton
								tooltip="Agents"
								isActive={Boolean(matchRoute({ to: "/agents" }))}
								render={<Link to="/agents" />}
							>
								<BotIcon aria-hidden="true" />
								<span>Agents</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								tooltip="Devices"
								isActive={Boolean(matchRoute({ to: "/devices" }))}
								render={<Link to="/devices" />}
							>
								<MonitorSmartphoneIcon aria-hidden="true" />
								<span>Devices</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								tooltip="Settings"
								isActive={Boolean(matchRoute({ to: "/settings" }))}
								render={<Link to="/settings" />}
							>
								<Settings2Icon aria-hidden="true" />
								<span>Settings</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter>
				<SidebarMenu>
					<SidebarMenuItem>
						<DaemonStatus
							reachable={!projects.isError}
							loading={projects.isLoading}
						/>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<ThemeMenu />
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}

/**
 * The projects, each a folder with its flows, runs and schedules. The + on
 * the group label is the one place to add a project.
 */
function NavProjects({ projects }: { projects: Project[] | undefined }) {
	const [adding, setAdding] = useState(false);
	return (
		<SidebarGroup>
			<SidebarGroupLabel>Projects</SidebarGroupLabel>
			<SidebarGroupAction title="Add project" onClick={() => setAdding(true)}>
				<PlusIcon aria-hidden="true" />
				<span className="sr-only">Add project</span>
			</SidebarGroupAction>
			<SidebarMenu>
				{projects?.map((project) => (
					<ProjectFolder key={project.id} project={project} />
				))}
			</SidebarMenu>
			<AddProjectDialog open={adding} onOpenChange={setAdding} />
		</SidebarGroup>
	);
}

/** One project: its name opens the dashboard, the chevron opens the folder. */
function ProjectFolder({ project }: { project: Project }) {
	const matchRoute = useMatchRoute();
	const params = { projectId: project.id };
	const inProject = Boolean(
		matchRoute({ to: "/projects/$projectId", params, fuzzy: true }),
	);
	const [open, setOpen] = useState(inProject);
	// Entering a project opens its folder; leaving it does not close it.
	useEffect(() => {
		if (inProject) setOpen(true);
	}, [inProject]);
	const Icon = open ? FolderOpenIcon : FolderIcon;

	const flows = useQuery({
		...orpc.flows.list.queryOptions({ input: params }),
		staleTime: 30_000,
		meta: { quietErrors: true },
	});
	const schedules = useQuery({
		...orpc.schedules.list.queryOptions({ input: params }),
		staleTime: 30_000,
		meta: { quietErrors: true },
	});
	const runs = useProjectRuns(project.id);
	const schedulesOn = schedules.data?.schedules.filter((s) => s.enabled);

	return (
		<Collapsible
			open={open}
			onOpenChange={setOpen}
			render={<SidebarMenuItem />}
		>
			<SidebarMenuButton
				tooltip={project.name}
				isActive={Boolean(matchRoute({ to: "/projects/$projectId", params }))}
				render={<Link to="/projects/$projectId" params={params} />}
			>
				<Icon aria-hidden="true" />
				<span>{project.name}</span>
			</SidebarMenuButton>
			<CollapsibleTrigger
				render={
					<SidebarMenuAction className="transition-transform data-panel-open:rotate-90" />
				}
			>
				<ChevronRightIcon aria-hidden="true" />
				<span className="sr-only">
					{open ? "Close" : "Open"} {project.name}
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				{/* Full-width rows, indented to the project name, so a count fits on the right. */}
				<SidebarMenu className="mt-1 group-data-[collapsible=icon]:hidden">
					<ProjectPageItem
						to="/projects/$projectId/flows"
						projectId={project.id}
						label="Flows"
						icon={WorkflowIcon}
						badge={
							flows.data ? (
								<SidebarMenuBadge
									aria-label={`${flows.data.length} ${flows.data.length === 1 ? "flow" : "flows"}`}
								>
									{flows.data.length}
								</SidebarMenuBadge>
							) : null
						}
					/>
					<ProjectPageItem
						to="/projects/$projectId/runs"
						projectId={project.id}
						label="Runs"
						icon={HistoryIcon}
						// The menu button hides its tooltip while the sidebar is open; this one is the breakdown.
						tooltip={
							runs.data && runs.data.length > 0
								? { children: describeRunStatuses(runs.data), hidden: false }
								: undefined
						}
						badge={
							runs.data ? (
								<SidebarMenuBadge
									className="gap-1.5"
									aria-label={describeRunStatuses(runs.data)}
								>
									{runs.data.length > 0 ? <RunsDonut runs={runs.data} /> : null}
									{runs.data.length}
								</SidebarMenuBadge>
							) : null
						}
					/>
					<ProjectPageItem
						to="/projects/$projectId/schedules"
						projectId={project.id}
						label="Schedules"
						icon={CalendarClockIcon}
						badge={
							schedules.data && schedulesOn ? (
								<SidebarMenuBadge
									aria-label={`${schedulesOn.length} of ${schedules.data.schedules.length} schedules on`}
								>
									{schedulesOn.length}
								</SidebarMenuBadge>
							) : null
						}
					/>
				</SidebarMenu>
			</CollapsibleContent>
		</Collapsible>
	);
}

function ProjectPageItem({
	to,
	projectId,
	label,
	icon: PageIcon,
	tooltip,
	badge,
}: {
	to:
		| "/projects/$projectId/flows"
		| "/projects/$projectId/runs"
		| "/projects/$projectId/schedules";
	projectId: string;
	label: string;
	icon: LucideIcon;
	tooltip?: ComponentProps<typeof SidebarMenuButton>["tooltip"];
	badge: ReactNode;
}) {
	const matchRoute = useMatchRoute();
	const params = { projectId };
	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				className="pl-8"
				tooltip={tooltip}
				isActive={Boolean(matchRoute({ to, params, fuzzy: true }))}
				render={<Link to={to} params={params} />}
			>
				<PageIcon aria-hidden="true" />
				<span>{label}</span>
			</SidebarMenuButton>
			{badge}
		</SidebarMenuItem>
	);
}

function DaemonStatus({
	reachable,
	loading,
}: {
	reachable: boolean;
	loading: boolean;
}) {
	const label = loading
		? "Connecting to Night Shift…"
		: reachable
			? "Night Shift is running"
			: "Cannot reach Night Shift";
	return (
		<SidebarMenuButton
			tooltip={label}
			className="pointer-events-none text-muted-foreground"
			aria-live="polite"
			render={<div />}
		>
			<span className="relative flex size-4 items-center justify-center">
				{reachable && !loading ? (
					<span className="absolute size-2 animate-ping rounded-full bg-status-finished/60 motion-reduce:hidden" />
				) : null}
				<span
					className={
						loading
							? "size-2 rounded-full bg-muted-foreground"
							: reachable
								? "size-2 rounded-full bg-status-finished"
								: "size-2 rounded-full bg-status-failed"
					}
				/>
			</span>
			<span className="text-xs">{label}</span>
		</SidebarMenuButton>
	);
}

const THEMES = [
	{ value: "light", label: "Light", icon: SunIcon },
	{ value: "dark", label: "Dark", icon: MoonIcon },
	{ value: "system", label: "System", icon: MonitorIcon },
] as const;

function ThemeMenu() {
	const { theme = "system", setTheme } = useTheme();
	// The theme is known only in the browser: the trigger names none, so the
	// server's HTML matches. The menu shows the choice.
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<SidebarMenuButton tooltip="Theme" />}>
				<SunMoonIcon aria-hidden="true" />
				<span>Theme</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="top" align="start" className="min-w-40">
				<DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
					{THEMES.map(({ value, label, icon: ItemIcon }) => (
						<DropdownMenuRadioItem key={value} value={value}>
							<ItemIcon aria-hidden="true" />
							{label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
