/**
 * PROTOTYPE variant B, "Everything in menus" (shadcn sidebar-06 + sidebar-07):
 * the sidebar keeps only what you visit every day: Home, Inbox and the
 * projects. A project's pages open from its ⋯ menu. The Space, this
 * computer and your account move into one menu in the footer.
 */
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
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
	CalendarClockIcon,
	ChevronsUpDownIcon,
	CircleUserRoundIcon,
	FolderIcon,
	GitBranchIcon,
	HistoryIcon,
	HouseIcon,
	InboxIcon,
	KeyRoundIcon,
	MonitorSmartphoneIcon,
	MoreHorizontalIcon,
	PlusIcon,
	Settings2Icon,
	UsersIcon,
	WorkflowIcon,
} from "lucide-react";
import { useState } from "react";
import { useOpenGates } from "@/features/gates";
import { AddProjectDialog, projectQueries } from "@/features/projects";
import { SpaceSwitcher } from "@/features/spaces";
import type { Project } from "@/shared/api";

export function NavMenusSidebar() {
	const matchRoute = useMatchRoute();
	const gates = useOpenGates();
	const open = gates.data?.length ?? 0;
	const projects = useQuery(projectQueries.list());
	const [adding, setAdding] = useState(false);

	return (
		<Sidebar collapsible="icon">
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
								<HouseIcon />
								<span>Home</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								tooltip="Inbox"
								isActive={Boolean(matchRoute({ to: "/inbox" }))}
								render={<Link to="/inbox" />}
							>
								<InboxIcon />
								<span>Inbox</span>
							</SidebarMenuButton>
							{open > 0 ? (
								<SidebarMenuBadge className="bg-status-waiting/15 text-status-waiting">
									{open}
								</SidebarMenuBadge>
							) : null}
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
				<SidebarGroup>
					<SidebarGroupLabel>Projects</SidebarGroupLabel>
					<SidebarGroupAction
						title="Add project"
						onClick={() => setAdding(true)}
					>
						<PlusIcon />
						<span className="sr-only">Add project</span>
					</SidebarGroupAction>
					<SidebarMenu>
						{projects.data?.map((project) => (
							<ProjectWithMenu key={project.id} project={project} />
						))}
					</SidebarMenu>
					<AddProjectDialog open={adding} onOpenChange={setAdding} />
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter>
				<SidebarMenu>
					<SidebarMenuItem>
						<SettingsMenu reachable={!projects.isError} />
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}

const PROJECT_PAGES = [
	{ to: "/projects/$projectId/flows", label: "Flows", icon: WorkflowIcon },
	{ to: "/projects/$projectId/runs", label: "Runs", icon: HistoryIcon },
	{
		to: "/projects/$projectId/schedules",
		label: "Schedules",
		icon: CalendarClockIcon,
	},
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
] as const;

function ProjectWithMenu({ project }: { project: Project }) {
	const matchRoute = useMatchRoute();
	const { isMobile } = useSidebar();
	const params = { projectId: project.id };
	const running = (project.runs?.statuses.running ?? 0) > 0;
	const current = PROJECT_PAGES.find((p) =>
		matchRoute({ to: p.to, params, fuzzy: true }),
	);
	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				tooltip={project.name}
				isActive={Boolean(
					matchRoute({ to: "/projects/$projectId", params, fuzzy: true }),
				)}
				render={<Link to="/projects/$projectId" params={params} />}
			>
				<span className="relative flex shrink-0">
					<FolderIcon />
					{running ? (
						<span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-status-running" />
					) : null}
				</span>
				<span>{project.name}</span>
				{/* Where you are inside the project, without opening a tree. */}
				{current ? (
					<span className="ml-auto text-muted-foreground text-xs">
						{current.label}
					</span>
				) : null}
			</SidebarMenuButton>
			<DropdownMenu>
				<DropdownMenuTrigger render={<SidebarMenuAction showOnHover />}>
					<MoreHorizontalIcon />
					<span className="sr-only">Pages of {project.name}</span>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					className="min-w-44"
					side={isMobile ? "bottom" : "right"}
					align="start"
				>
					{PROJECT_PAGES.filter(
						(p) => p.label !== "Branches" || project.repoPath !== null,
					).map(({ to, label, icon: Icon }) => (
						<DropdownMenuItem
							key={to}
							render={<Link to={to} params={params} />}
						>
							<Icon />
							{label}
							{label === "Runs" && project.runs ? (
								<span className="ml-auto text-muted-foreground text-xs tabular-nums">
									{project.runs.total}
								</span>
							) : null}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</SidebarMenuItem>
	);
}

/** One menu for everything you set up once: the Space, this computer, you. */
function SettingsMenu({ reachable }: { reachable: boolean }) {
	const { isMobile } = useSidebar();
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<SidebarMenuButton
							size="lg"
							tooltip="Settings"
							className="data-popup-open:bg-sidebar-accent"
						/>
					}
				>
					<span className="relative flex size-8 items-center justify-center rounded-lg border">
						<Settings2Icon />
						<span
							className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-sidebar ${reachable ? "bg-status-finished" : "bg-status-failed"}`}
						/>
					</span>
					<div className="grid flex-1 text-left text-sm leading-tight">
						<span className="truncate font-medium">Settings</span>
						<span className="truncate text-muted-foreground text-xs">
							{reachable
								? "Night Shift is running"
								: "Cannot reach Night Shift"}
						</span>
					</div>
					<ChevronsUpDownIcon className="ml-auto" />
				</DropdownMenuTrigger>
				<DropdownMenuContent
					className="min-w-56"
					side={isMobile ? "bottom" : "right"}
					align="end"
				>
					<DropdownMenuGroup>
						<DropdownMenuLabel>This Space</DropdownMenuLabel>
						<DropdownMenuItem render={<Link to="/members" />}>
							<UsersIcon />
							Members
						</DropdownMenuItem>
						<DropdownMenuItem render={<Link to="/devices" />}>
							<MonitorSmartphoneIcon />
							Devices
						</DropdownMenuItem>
						<DropdownMenuItem render={<Link to="/space-secrets" />}>
							<KeyRoundIcon />
							Secrets
						</DropdownMenuItem>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuLabel>This computer</DropdownMenuLabel>
						<DropdownMenuItem render={<Link to="/agents" />}>
							<BotIcon />
							Agents
						</DropdownMenuItem>
						<DropdownMenuItem render={<Link to="/secrets" />}>
							<KeyRoundIcon />
							Secrets
						</DropdownMenuItem>
						<DropdownMenuItem render={<Link to="/settings" />}>
							<Settings2Icon />
							Settings
						</DropdownMenuItem>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuItem render={<Link to="/account" />}>
						<CircleUserRoundIcon />
						Account
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
