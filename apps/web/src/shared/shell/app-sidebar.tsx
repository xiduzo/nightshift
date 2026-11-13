import { Badge } from "@nightshift/ui/components/badge";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarRail,
	useSidebar,
} from "@nightshift/ui/components/sidebar";
import { useQuery } from "@tanstack/react-query";
import { Link, useMatchRoute } from "@tanstack/react-router";
import {
	BookOpenIcon,
	BotIcon,
	ChevronRightIcon,
	ChevronsUpDownIcon,
	CircleUserRoundIcon,
	CoinsIcon,
	CpuIcon,
	FolderIcon,
	FolderOpenIcon,
	HistoryIcon,
	HouseIcon,
	InboxIcon,
	KeyRoundIcon,
	type LucideIcon,
	MonitorIcon,
	MonitorSmartphoneIcon,
	MoonIcon,
	PlusIcon,
	Settings2Icon,
	SparklesIcon,
	SunIcon,
	SunMoonIcon,
	TerminalIcon,
	UsersIcon,
	WorkflowIcon,
	WrenchIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { type ComponentProps, useState } from "react";
import { describeRunStatuses, RunsDonut } from "@/features/dashboard";
import { ThisDeviceLabel } from "@/features/devices";
import { useOpenGates } from "@/features/gates";
import { AddProjectDialog, projectQueries } from "@/features/projects";
import { SpaceSwitcher } from "@/features/spaces";
import type { Project } from "@/shared/api";
import { useSidebarRange } from "./use-sidebar-range";

/**
 * The app shell's sidebar, after the shadcn `sidebar-07` block. It keeps
 * what you open every day: Home,
 * the Inbox, Spend and the projects. The project you are in shows its pages. The
 * Space, this computer, your account and the theme sit in one Settings
 * menu in the footer.
 */
export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
	const matchRoute = useMatchRoute();
	const gates = useOpenGates();
	const open = gates.data?.length ?? 0;
	const projects = useQuery(projectQueries.list());

	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<SpaceSwitcher />
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
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
								{/* The menu badge hides in the icon rail. There the count sits on the icon. */}
								<span className="relative flex shrink-0">
									<InboxIcon aria-hidden="true" />
									{open > 0 ? (
										<Badge
											aria-label={`${open} ${open === 1 ? "gate waits" : "gates wait"} for you`}
											className="absolute -top-2 -right-2 hidden h-4 min-w-4 bg-status-waiting px-1 text-[10px] text-background tabular-nums group-data-[collapsible=icon]:inline-flex"
										>
											{open > 9 ? "9+" : open}
										</Badge>
									) : null}
								</span>
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
								tooltip="Spend"
								isActive={Boolean(matchRoute({ to: "/spend" }))}
								render={<Link to="/spend" />}
							>
								<CoinsIcon aria-hidden="true" />
								<span>Spend</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
				<NavProjects projects={projects.data} />
			</SidebarContent>
			<SidebarFooter>
				<SidebarMenu>
					<SidebarMenuItem>
						<SettingsMenu
							reachable={!projects.isError}
							loading={projects.isLoading}
						/>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}

/**
 * The projects. Only the project you are in is open and shows its pages.
 * The chevron opens or closes any other. Add project sits below the list.
 */
function NavProjects({ projects }: { projects: Project[] | undefined }) {
	const [adding, setAdding] = useState(false);
	const range = useSidebarRange();
	return (
		<SidebarGroup>
			<SidebarGroupLabel>Projects</SidebarGroupLabel>
			<SidebarMenu>
				{projects?.map((project) => (
					<ProjectItem key={project.id} project={project} range={range} />
				))}
				<SidebarMenuItem>
					<SidebarMenuButton
						tooltip="Add project"
						className="text-sidebar-foreground/70"
						onClick={() => setAdding(true)}
					>
						<PlusIcon aria-hidden="true" />
						<span>Add project</span>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
			<AddProjectDialog open={adding} onOpenChange={setAdding} />
		</SidebarGroup>
	);
}

type ProjectPageRoute =
	| "/projects/$projectId/flows"
	| "/projects/$projectId/runs"
	| "/projects/$projectId/knowledge"
	| "/projects/$projectId/secrets";

const PROJECT_PAGES: {
	to: ProjectPageRoute;
	label: string;
	icon: LucideIcon;
}[] = [
	{ to: "/projects/$projectId/flows", label: "Flows", icon: WorkflowIcon },
	{ to: "/projects/$projectId/runs", label: "Runs", icon: HistoryIcon },
	{
		to: "/projects/$projectId/knowledge",
		label: "Knowledge",
		icon: BookOpenIcon,
	},
	{ to: "/projects/$projectId/secrets", label: "Secrets", icon: KeyRoundIcon },
];

/**
 * One project: its name opens the project's page. Its icon is a donut of
 * its runs over the range of Home or the project's page. Opened, it lists
 * the project's other pages, after the collapsible menus of `sidebar-07`.
 */
function ProjectItem({ project, range }: { project: Project; range: number }) {
	const matchRoute = useMatchRoute();
	const params = { projectId: project.id };
	const inProject = Boolean(
		matchRoute({ to: "/projects/$projectId", params, fuzzy: true }),
	);
	// Open when you enter the project, closed when you leave it. The chevron
	// changes it in between.
	const [open, setOpen] = useState(inProject);
	const [wasInProject, setWasInProject] = useState(inProject);
	if (wasInProject !== inProject) {
		setWasInProject(inProject);
		setOpen(inProject);
	}
	const Icon = inProject ? FolderOpenIcon : FolderIcon;

	// Counted by Night Shift with the project list: no read per project.
	const running = (project.runs?.statuses.running ?? 0) > 0;
	const inRange = project.runs?.nights?.find((r) => r.nights === range);
	const runs = inRange
		? `Last ${range} days: ${describeRunStatuses(inRange)}`
		: null;
	const label = [project.name, runs, running ? "A run is in progress" : null]
		.filter(Boolean)
		.join(". ");

	return (
		<Collapsible
			open={open}
			onOpenChange={setOpen}
			render={<SidebarMenuItem />}
		>
			<SidebarMenuButton
				tooltip={label}
				isActive={Boolean(matchRoute({ to: "/projects/$projectId", params }))}
				render={<Link to="/projects/$projectId" params={params} />}
			>
				{/* A pulsing dot on the icon while a run in this project is in progress. */}
				<span className="relative flex shrink-0">
					{inRange ? <RunsDonut runs={inRange} /> : <Icon aria-hidden="true" />}
					{running ? (
						<span className="absolute -top-0.5 -right-0.5 flex size-2">
							<span className="absolute inset-0 animate-ping rounded-full bg-status-running/60 motion-reduce:hidden" />
							<span className="relative size-2 rounded-full bg-status-running" />
						</span>
					) : null}
				</span>
				<span className="truncate">
					{project.name}
					{label !== project.name ? (
						<span className="sr-only">{label.slice(project.name.length)}</span>
					) : null}
				</span>
			</SidebarMenuButton>
			<CollapsibleTrigger
				render={
					<SidebarMenuAction className="transition-transform data-panel-open:rotate-90" />
				}
			>
				<ChevronRightIcon aria-hidden="true" />
				<span className="sr-only">Pages of {project.name}</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<SidebarMenuSub>
					<ProjectPages project={project} />
				</SidebarMenuSub>
			</CollapsibleContent>
		</Collapsible>
	);
}

/** The pages of a project under it. */
function ProjectPages({ project }: { project: Project }) {
	const matchRoute = useMatchRoute();
	const params = { projectId: project.id };
	return PROJECT_PAGES.map(({ to, label, icon: PageIcon }) => (
		<SidebarMenuSubItem key={to}>
			<SidebarMenuSubButton
				isActive={Boolean(matchRoute({ to, params, fuzzy: true }))}
				render={<Link to={to} params={params} />}
			>
				<PageIcon aria-hidden="true" />
				<span>{label}</span>
			</SidebarMenuSubButton>
		</SidebarMenuSubItem>
	));
}

/**
 * One menu for what you set up once: the Space, this computer, your
 * account and the theme. Its button also says whether Night Shift runs.
 */
function SettingsMenu({
	reachable,
	loading,
}: {
	reachable: boolean;
	loading: boolean;
}) {
	const { isMobile } = useSidebar();
	const matchRoute = useMatchRoute();
	const status = loading
		? "Connecting to Night Shift…"
		: reachable
			? "Night Shift is running"
			: "Cannot reach Night Shift";
	const onSettingsPage = SETTINGS_PAGES.some((page) =>
		matchRoute({ to: page }),
	);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<SidebarMenuButton
						size="lg"
						tooltip={`Settings. ${status}`}
						isActive={onSettingsPage}
						className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
					/>
				}
			>
				<span className="relative flex size-8 shrink-0 items-center justify-center rounded-lg border">
					<Settings2Icon aria-hidden="true" />
					<span
						aria-hidden="true"
						className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-sidebar ${
							loading
								? "bg-muted-foreground"
								: reachable
									? "bg-status-finished"
									: "bg-status-failed"
						}`}
					/>
				</span>
				<div className="grid flex-1 text-left text-sm leading-tight">
					<span className="truncate font-medium">Settings</span>
					<span
						className="truncate text-muted-foreground text-xs"
						aria-live="polite"
					>
						{status}
					</span>
				</div>
				<ChevronsUpDownIcon className="ml-auto" aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				className="min-w-56"
				side={isMobile ? "bottom" : "right"}
				align="end"
			>
				<DropdownMenuGroup>
					<DropdownMenuLabel>Space</DropdownMenuLabel>
					<MenuLink to="/members" label="Members" icon={UsersIcon} />
					<MenuLink
						to="/devices"
						label="Devices"
						icon={MonitorSmartphoneIcon}
					/>
					<MenuLink to="/space-secrets" label="Secrets" icon={KeyRoundIcon} />
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				{/* Saved on this computer only: its agents, secrets and settings. */}
				<DropdownMenuGroup>
					<ThisDeviceLabel />
					{/* The pages of Settings that hold the agents, then all of them. */}
					<MenuLink
						to="/settings"
						section="builtin"
						label="Night Shift's agents"
						icon={SparklesIcon}
					/>
					<MenuLink
						to="/settings"
						section="agents"
						label="Your agents"
						icon={BotIcon}
					/>
					<MenuLink
						to="/settings"
						section="harnesses"
						label="Your harnesses"
						icon={TerminalIcon}
					/>
					<MenuLink
						to="/settings"
						section="models"
						label="Models"
						icon={CpuIcon}
					/>
					<MenuLink
						to="/settings"
						section="tools"
						label="Tools"
						icon={WrenchIcon}
					/>
					<MenuLink to="/secrets" label="Secrets" icon={KeyRoundIcon} />
					<MenuLink to="/settings" label="All settings" icon={Settings2Icon} />
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<MenuLink to="/account" label="Account" icon={CircleUserRoundIcon} />
					<ThemeSubmenu />
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

const SETTINGS_PAGES = [
	"/members",
	"/devices",
	"/space-secrets",
	"/secrets",
	"/settings",
	"/account",
] as const;

function MenuLink({
	to,
	section,
	label,
	icon: ItemIcon,
}: {
	/** A page of Settings, when `to` is "/settings". None: its overview. */
	section?: string;
	to: (typeof SETTINGS_PAGES)[number];
	label: string;
	icon: LucideIcon;
}) {
	return (
		<DropdownMenuItem
			render={
				section ? (
					<Link to="/settings" search={{ section }} />
				) : (
					<Link to={to} />
				)
			}
		>
			<ItemIcon aria-hidden="true" />
			{label}
		</DropdownMenuItem>
	);
}

const THEMES = [
	{ value: "light", label: "Light", icon: SunIcon },
	{ value: "dark", label: "Dark", icon: MoonIcon },
	{ value: "system", label: "System", icon: MonitorIcon },
] as const;

function ThemeSubmenu() {
	const { theme = "system", setTheme } = useTheme();
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<SunMoonIcon aria-hidden="true" />
				Theme
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="min-w-36">
				<DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
					{THEMES.map(({ value, label, icon: ItemIcon }) => (
						<DropdownMenuRadioItem key={value} value={value}>
							<ItemIcon aria-hidden="true" />
							{label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}
