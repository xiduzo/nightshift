/**
 * PROTOTYPE variant D, "Two rails" (shadcn sidebar-09, nested sidebars):
 * a thin rail of icons picks the area (Home, Inbox, Projects, Space, This
 * computer). A panel beside it lists only that area's pages. Each list
 * stays short because only one area shows at a time.
 */
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@nightshift/ui/components/sidebar";
import { useQuery } from "@tanstack/react-query";
import {
	Link,
	useMatchRoute,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import {
	BotIcon,
	CircleUserRoundIcon,
	FolderKanbanIcon,
	HouseIcon,
	InboxIcon,
	KeyRoundIcon,
	type LucideIcon,
	MonitorIcon,
	MonitorSmartphoneIcon,
	PlusIcon,
	Settings2Icon,
	UsersIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useOpenGates } from "@/features/gates";
import { AddProjectDialog, projectQueries } from "@/features/projects";
import { SpaceSwitcher } from "@/features/spaces";
import type { Project } from "@/shared/api";
import { Logo } from "@/shared/page";
import { DaemonStatus, ProjectFolder, ThemeMenu } from "./app-sidebar";

type Area = "projects" | "space" | "computer";

const AREA_OF: [RegExp, Area][] = [
	[/^\/(members|devices|space-secrets)/, "space"],
	[/^\/(agents|secrets|settings|account)/, "computer"],
];
const areaFor = (pathname: string): Area =>
	AREA_OF.find(([re]) => re.test(pathname))?.[1] ?? "projects";

/** The provider width for this variant: the rail plus the panel. */
export const RAILS_WIDTH = "20rem";

export function NavRailsSidebar() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const [area, setArea] = useState<Area>(areaFor(pathname));
	useEffect(() => setArea(areaFor(pathname)), [pathname]);
	const { setOpen } = useSidebar();
	const navigate = useNavigate();
	const matchRoute = useMatchRoute();
	const gates = useOpenGates();
	const open = gates.data?.length ?? 0;
	const projects = useQuery(projectQueries.list());

	const pick = (next: Area) => {
		setArea(next);
		setOpen(true);
	};

	return (
		<Sidebar
			collapsible="icon"
			className="overflow-hidden *:data-[sidebar=sidebar]:flex-row"
		>
			{/* The rail. */}
			<Sidebar
				collapsible="none"
				className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r"
			>
				<SidebarHeader>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton
								size="lg"
								className="md:h-8 md:p-0"
								render={<Link to="/" />}
							>
								<Logo className="size-8!" />
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarHeader>
				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupContent className="px-1.5 md:px-0">
							<SidebarMenu>
								<RailButton
									label="Home"
									icon={HouseIcon}
									active={Boolean(matchRoute({ to: "/" }))}
									onClick={() => navigate({ to: "/" })}
								/>
								<RailButton
									label={open > 0 ? `Inbox, ${open} waiting` : "Inbox"}
									icon={InboxIcon}
									dot={open > 0}
									active={Boolean(matchRoute({ to: "/inbox" }))}
									onClick={() => navigate({ to: "/inbox" })}
								/>
								<RailButton
									label="Projects"
									icon={FolderKanbanIcon}
									active={
										area === "projects" && pathname.startsWith("/projects")
									}
									onClick={() => pick("projects")}
								/>
								<RailButton
									label="Space"
									icon={UsersIcon}
									active={area === "space"}
									onClick={() => pick("space")}
								/>
								<RailButton
									label="This computer"
									icon={MonitorIcon}
									active={area === "computer"}
									onClick={() => pick("computer")}
								/>
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
				<SidebarFooter>
					<SidebarMenu>
						<SidebarMenuItem>
							<ThemeMenu />
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarFooter>
			</Sidebar>

			{/* The panel: only the chosen area. */}
			<Sidebar collapsible="none" className="hidden flex-1 md:flex">
				<SidebarHeader className="gap-3 border-b">
					<SpaceSwitcher />
				</SidebarHeader>
				<SidebarContent>
					{area === "projects" ? (
						<ProjectsPanel projects={projects.data ?? []} />
					) : area === "space" ? (
						<LinksPanel
							title="Space"
							links={[
								{ to: "/members", label: "Members", icon: UsersIcon },
								{
									to: "/devices",
									label: "Devices",
									icon: MonitorSmartphoneIcon,
								},
								{ to: "/space-secrets", label: "Secrets", icon: KeyRoundIcon },
							]}
						/>
					) : (
						<LinksPanel
							title="This computer"
							links={[
								{ to: "/agents", label: "Agents", icon: BotIcon },
								{ to: "/secrets", label: "Secrets", icon: KeyRoundIcon },
								{ to: "/settings", label: "Settings", icon: Settings2Icon },
								{ to: "/account", label: "Account", icon: CircleUserRoundIcon },
							]}
						/>
					)}
				</SidebarContent>
				<SidebarFooter>
					<SidebarMenu>
						<SidebarMenuItem>
							<DaemonStatus
								reachable={!projects.isError}
								loading={projects.isLoading}
							/>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarFooter>
			</Sidebar>
		</Sidebar>
	);
}

function RailButton({
	label,
	icon: Icon,
	active,
	dot,
	onClick,
}: {
	label: string;
	icon: LucideIcon;
	active: boolean;
	dot?: boolean;
	onClick: () => void;
}) {
	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				tooltip={{ children: label, hidden: false }}
				isActive={active}
				onClick={onClick}
				className="px-2.5 md:px-2"
			>
				<span className="relative flex shrink-0">
					<Icon />
					{dot ? (
						<span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-status-waiting" />
					) : null}
				</span>
				<span>{label}</span>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

function PanelTitle({ children }: { children: string }) {
	return (
		<div className="px-4 pt-3 pb-1 font-medium text-base text-foreground">
			{children}
		</div>
	);
}

function ProjectsPanel({ projects }: { projects: Project[] }) {
	const [adding, setAdding] = useState(false);
	return (
		<>
			<PanelTitle>Projects</PanelTitle>
			<SidebarGroup>
				<SidebarGroupAction title="Add project" onClick={() => setAdding(true)}>
					<PlusIcon />
					<span className="sr-only">Add project</span>
				</SidebarGroupAction>
				<SidebarMenu>
					{projects.map((project) => (
						<ProjectFolder key={project.id} project={project} />
					))}
				</SidebarMenu>
				<AddProjectDialog open={adding} onOpenChange={setAdding} />
			</SidebarGroup>
		</>
	);
}

function LinksPanel({
	title,
	links,
}: {
	title: string;
	links: {
		to:
			| "/members"
			| "/devices"
			| "/space-secrets"
			| "/agents"
			| "/secrets"
			| "/settings"
			| "/account";
		label: string;
		icon: LucideIcon;
	}[];
}) {
	const matchRoute = useMatchRoute();
	return (
		<>
			<PanelTitle>{title}</PanelTitle>
			<SidebarGroup>
				<SidebarMenu>
					{links.map(({ to, label, icon: Icon }) => (
						<SidebarMenuItem key={to}>
							<SidebarMenuButton
								isActive={Boolean(matchRoute({ to }))}
								render={<Link to={to} />}
							>
								<Icon />
								<span>{label}</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarGroup>
		</>
	);
}
