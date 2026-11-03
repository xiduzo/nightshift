/**
 * PROTOTYPE variant C, "Drill into a project" (shadcn sidebar-02 sections):
 * outside a project the sidebar lists Home, Inbox and the projects, flat.
 * Inside a project the whole sidebar becomes that project: its pages, with
 * a way back. The Space and this computer are closed sections at the
 * bottom that open by themselves on their own pages.
 */
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	SidebarSeparator,
} from "@nightshift/ui/components/sidebar";
import { useQuery } from "@tanstack/react-query";
import { Link, useMatchRoute, useRouterState } from "@tanstack/react-router";
import {
	ArrowLeftIcon,
	BotIcon,
	ChevronRightIcon,
	CircleUserRoundIcon,
	FolderIcon,
	FolderOpenIcon,
	HouseIcon,
	InboxIcon,
	KeyRoundIcon,
	type LucideIcon,
	MonitorSmartphoneIcon,
	PlusIcon,
	Settings2Icon,
	UsersIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useOpenGates } from "@/features/gates";
import { AddProjectDialog, projectQueries } from "@/features/projects";
import { SpaceSwitcher } from "@/features/spaces";
import type { Project } from "@/shared/api";
import { DaemonStatus, ProjectPages, ThemeMenu } from "./app-sidebar";

export function NavDrillSidebar() {
	const projects = useQuery(projectQueries.list());
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const projectId = /^\/projects\/([^/]+)/.exec(pathname)?.[1];
	const project = projects.data?.find((p) => p.id === projectId);

	return (
		<Sidebar collapsible="icon">
			<SidebarHeader>
				<SpaceSwitcher />
			</SidebarHeader>
			<SidebarContent>
				{project ? (
					<ProjectLevel project={project} />
				) : (
					<TopLevel projects={projects.data ?? []} />
				)}
				<div className="mt-auto" />
				<SidebarSeparator className="mx-0" />
				<Section
					label="Space"
					items={[
						{ to: "/members", label: "Members", icon: UsersIcon },
						{ to: "/devices", label: "Devices", icon: MonitorSmartphoneIcon },
						{ to: "/space-secrets", label: "Secrets", icon: KeyRoundIcon },
					]}
				/>
				<Section
					label="This computer"
					items={[
						{ to: "/agents", label: "Agents", icon: BotIcon },
						{ to: "/secrets", label: "Secrets", icon: KeyRoundIcon },
						{ to: "/settings", label: "Settings", icon: Settings2Icon },
						{ to: "/account", label: "Account", icon: CircleUserRoundIcon },
					]}
				/>
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

function TopLevel({ projects }: { projects: Project[] }) {
	const matchRoute = useMatchRoute();
	const gates = useOpenGates();
	const open = gates.data?.length ?? 0;
	const [adding, setAdding] = useState(false);
	return (
		<>
			<SidebarGroup>
				<SidebarMenu>
					<NavItem to="/" label="Home" icon={HouseIcon} />
					<NavItem
						to="/inbox"
						label="Inbox"
						icon={InboxIcon}
						badge={
							open > 0 ? (
								<SidebarMenuBadge className="bg-status-waiting/15 text-status-waiting">
									{open}
								</SidebarMenuBadge>
							) : null
						}
					/>
				</SidebarMenu>
			</SidebarGroup>
			<SidebarGroup>
				<SidebarGroupLabel>Projects</SidebarGroupLabel>
				<SidebarGroupAction title="Add project" onClick={() => setAdding(true)}>
					<PlusIcon />
					<span className="sr-only">Add project</span>
				</SidebarGroupAction>
				<SidebarMenu>
					{projects.map((project) => {
						const running = (project.runs?.statuses.running ?? 0) > 0;
						return (
							<SidebarMenuItem key={project.id}>
								<SidebarMenuButton
									tooltip={project.name}
									isActive={Boolean(
										matchRoute({
											to: "/projects/$projectId",
											params: { projectId: project.id },
										}),
									)}
									render={
										<Link
											to="/projects/$projectId"
											params={{ projectId: project.id }}
										/>
									}
								>
									<span className="relative flex shrink-0">
										<FolderIcon />
										{running ? (
											<span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-status-running" />
										) : null}
									</span>
									<span>{project.name}</span>
								</SidebarMenuButton>
								{/* A count of runs, so the flat list still says something. */}
								{project.runs && project.runs.total > 0 ? (
									<SidebarMenuBadge>{project.runs.total}</SidebarMenuBadge>
								) : null}
							</SidebarMenuItem>
						);
					})}
				</SidebarMenu>
				<AddProjectDialog open={adding} onOpenChange={setAdding} />
			</SidebarGroup>
		</>
	);
}

function ProjectLevel({ project }: { project: Project }) {
	const matchRoute = useMatchRoute();
	return (
		<>
			<SidebarGroup>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							tooltip="All projects"
							className="text-muted-foreground"
							render={<Link to="/" />}
						>
							<ArrowLeftIcon />
							<span>All projects</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarGroup>
			<SidebarGroup>
				<SidebarGroupLabel>Project</SidebarGroupLabel>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							size="lg"
							tooltip={project.name}
							isActive={Boolean(
								matchRoute({
									to: "/projects/$projectId",
									params: { projectId: project.id },
								}),
							)}
							render={
								<Link
									to="/projects/$projectId"
									params={{ projectId: project.id }}
								/>
							}
						>
							<span className="flex size-8 items-center justify-center rounded-lg border">
								<FolderOpenIcon />
							</span>
							<span className="truncate font-semibold">{project.name}</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
				<ProjectPages project={project} indent={false} />
			</SidebarGroup>
		</>
	);
}

function NavItem({
	to,
	label,
	icon: Icon,
	badge,
}: {
	to:
		| "/"
		| "/inbox"
		| "/members"
		| "/devices"
		| "/space-secrets"
		| "/agents"
		| "/secrets"
		| "/settings"
		| "/account";
	label: string;
	icon: LucideIcon;
	badge?: ReactNode;
}) {
	const matchRoute = useMatchRoute();
	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				tooltip={label}
				isActive={Boolean(matchRoute({ to }))}
				render={<Link to={to} />}
			>
				<Icon />
				<span>{label}</span>
			</SidebarMenuButton>
			{badge}
		</SidebarMenuItem>
	);
}

/** A section that stays closed until you need it, and opens on its own pages. */
function Section({
	label,
	items,
}: {
	label: string;
	items: {
		to: Parameters<typeof NavItem>[0]["to"];
		label: string;
		icon: LucideIcon;
	}[];
}) {
	const matchRoute = useMatchRoute();
	const here = items.some((i) => matchRoute({ to: i.to }));
	const [open, setOpen] = useState(here);
	return (
		<Collapsible
			open={open || here}
			onOpenChange={setOpen}
			render={<SidebarGroup className="py-0" />}
		>
			<SidebarGroupLabel
				render={<CollapsibleTrigger />}
				className="group/label w-full text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
			>
				{label}
				<ChevronRightIcon className="ml-auto transition-transform group-data-panel-open/label:rotate-90" />
			</SidebarGroupLabel>
			<CollapsibleContent>
				<SidebarGroupContent>
					<SidebarMenu>
						{items.map((i) => (
							<NavItem key={i.to + i.label} {...i} />
						))}
					</SidebarMenu>
				</SidebarGroupContent>
			</CollapsibleContent>
		</Collapsible>
	);
}
