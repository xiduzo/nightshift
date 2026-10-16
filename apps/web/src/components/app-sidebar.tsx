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
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
} from "@nightshift/ui/components/sidebar";
import { useQuery } from "@tanstack/react-query";
import { Link, useMatchRoute } from "@tanstack/react-router";
import {
	FolderGitIcon,
	HouseIcon,
	InboxIcon,
	MonitorIcon,
	MoonIcon,
	MoonStarIcon,
	SunIcon,
	SunMoonIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import type { ComponentProps } from "react";

import { useOpenGates } from "@/hooks/use-open-gates";
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
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" render={<Link to="/" />}>
							<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
								<MoonStarIcon className="size-4" aria-hidden="true" />
							</div>
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-semibold">Night Shift</span>
								<span className="truncate text-muted-foreground text-xs">
									Flows that run while you sleep
								</span>
							</div>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
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
					</SidebarMenu>
				</SidebarGroup>
				<SidebarGroup>
					<SidebarGroupLabel>Projects</SidebarGroupLabel>
					<SidebarMenu>
						{projects.data?.map((project) => (
							<SidebarMenuItem key={project.id}>
								<SidebarMenuButton
									tooltip={project.name}
									isActive={Boolean(
										matchRoute({
											to: "/projects/$projectId",
											params: { projectId: project.id },
											fuzzy: true,
										}),
									)}
									render={
										<Link
											to="/projects/$projectId"
											params={{ projectId: project.id }}
										/>
									}
								>
									<FolderGitIcon aria-hidden="true" />
									<span>{project.name}</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						))}
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

function DaemonStatus({
	reachable,
	loading,
}: {
	reachable: boolean;
	loading: boolean;
}) {
	const label = loading
		? "Connecting to the daemon…"
		: reachable
			? "Daemon running on this Mac"
			: "Daemon not reachable";
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
