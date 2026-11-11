import { Badge } from "@nightshift/ui/components/badge";
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
	SidebarGroupAction,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	useSidebar,
} from "@nightshift/ui/components/sidebar";
import { useQuery } from "@tanstack/react-query";
import { Link, useMatchRoute } from "@tanstack/react-router";
import {
	BookOpenIcon,
	BotIcon,
	ChevronsUpDownIcon,
	CircleUserRoundIcon,
	FolderIcon,
	FolderOpenIcon,
	GitBranchIcon,
	HistoryIcon,
	HouseIcon,
	InboxIcon,
	KeyRoundIcon,
	type LucideIcon,
	MonitorIcon,
	MonitorSmartphoneIcon,
	MoonIcon,
	MoreHorizontalIcon,
	PlusIcon,
	Settings2Icon,
	SunIcon,
	SunMoonIcon,
	UsersIcon,
	WorkflowIcon,
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
 * The app shell's sidebar, after the shadcn `sidebar-07` block with the
 * project menus of `sidebar-06`. It keeps what you open every day: Home,
 * the Inbox and the projects. A project's pages open from its ⋯ menu. The
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

/** The projects. The + on the group label is the one place to add a project. */
function NavProjects({ projects }: { projects: Project[] | undefined }) {
	const [adding, setAdding] = useState(false);
	const range = useSidebarRange();
	return (
		<SidebarGroup>
			<SidebarGroupLabel>Projects</SidebarGroupLabel>
			<SidebarGroupAction title="Add project" onClick={() => setAdding(true)}>
				<PlusIcon aria-hidden="true" />
				<span className="sr-only">Add project</span>
			</SidebarGroupAction>
			<SidebarMenu>
				{projects?.map((project) => (
					<ProjectItem key={project.id} project={project} range={range} />
				))}
			</SidebarMenu>
			<AddProjectDialog open={adding} onOpenChange={setAdding} />
		</SidebarGroup>
	);
}

type ProjectPageRoute =
	| "/projects/$projectId/flows"
	| "/projects/$projectId/runs"
	| "/projects/$projectId/knowledge"
	| "/projects/$projectId/secrets"
	| "/projects/$projectId/branches";

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
	{
		to: "/projects/$projectId/branches",
		label: "Branches",
		icon: GitBranchIcon,
	},
];

/**
 * One project: its name opens the project's page and names the page of
 * the project you are on. Its icon is a donut of its runs over the range
 * of Home or the project's page. The ⋯ menu opens its other pages.
 */
function ProjectItem({ project, range }: { project: Project; range: number }) {
	const matchRoute = useMatchRoute();
	const { isMobile } = useSidebar();
	const params = { projectId: project.id };
	const inProject = Boolean(
		matchRoute({ to: "/projects/$projectId", params, fuzzy: true }),
	);
	const current = PROJECT_PAGES.find((page) =>
		matchRoute({ to: page.to, params, fuzzy: true }),
	);
	const Icon = inProject ? FolderOpenIcon : FolderIcon;

	// Counted by Night Shift with the project list: no read per project.
	const running = (project.runs?.statuses.running ?? 0) > 0;
	const inRange = project.runs?.nights?.find((r) => r.nights === range);
	const runs = inRange
		? `Last ${range} nights: ${describeRunStatuses(inRange)}`
		: null;
	const label = [project.name, runs, running ? "A run is in progress" : null]
		.filter(Boolean)
		.join(". ");

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				tooltip={label}
				isActive={inProject}
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
				{current ? (
					<span className="ml-auto pr-5 text-muted-foreground text-xs">
						{current.label}
					</span>
				) : null}
			</SidebarMenuButton>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<SidebarMenuAction
							showOnHover
							className="data-popup-open:opacity-100"
						/>
					}
				>
					<MoreHorizontalIcon aria-hidden="true" />
					<span className="sr-only">Pages of {project.name}</span>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					className="min-w-48"
					side={isMobile ? "bottom" : "right"}
					align={isMobile ? "end" : "start"}
				>
					<ProjectPages project={project} />
				</DropdownMenuContent>
			</DropdownMenu>
		</SidebarMenuItem>
	);
}

/** The pages of a project in its menu. */
function ProjectPages({ project }: { project: Project }) {
	return PROJECT_PAGES.filter(
		// What runs left in the project's folder: only where it has one.
		(page) =>
			page.to !== "/projects/$projectId/branches" || project.repoPath !== null,
	).map(({ to, label, icon: PageIcon }) => (
		<DropdownMenuItem
			key={to}
			render={<Link to={to} params={{ projectId: project.id }} />}
		>
			<PageIcon aria-hidden="true" />
			{label}
		</DropdownMenuItem>
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
					<MenuLink to="/agents" label="Agents" icon={BotIcon} />
					<MenuLink to="/secrets" label="Secrets" icon={KeyRoundIcon} />
					<MenuLink to="/settings" label="Settings" icon={Settings2Icon} />
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
	"/agents",
	"/secrets",
	"/settings",
	"/account",
] as const;

function MenuLink({
	to,
	label,
	icon: ItemIcon,
}: {
	to: (typeof SETTINGS_PAGES)[number];
	label: string;
	icon: LucideIcon;
}) {
	return (
		<DropdownMenuItem render={<Link to={to} />}>
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
