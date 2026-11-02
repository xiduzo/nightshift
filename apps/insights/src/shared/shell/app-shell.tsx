import { Button } from "@nightshift/ui/components/button";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarRail,
} from "@nightshift/ui/components/sidebar";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
	CalendarClockIcon,
	HouseIcon,
	MonitorSmartphoneIcon,
	MoonIcon,
	SunIcon,
	WorkflowIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { authClient } from "@/shared/api";

const ITEMS = [
	{ to: "/", label: "Overview", icon: HouseIcon },
	{ to: "/first-night", label: "First night", icon: WorkflowIcon },
	{ to: "/nights", label: "Nights", icon: MoonIcon },
	{ to: "/mornings", label: "Mornings", icon: SunIcon },
	{ to: "/mix", label: "Mix", icon: MonitorSmartphoneIcon },
	{ to: "/retention", label: "Retention", icon: CalendarClockIcon },
] as const;

/** The signed-in frame: the sidebar and the page. */
export function AppShell({
	extra,
	children,
}: {
	extra?: ReactNode;
	children: ReactNode;
}) {
	const router = useRouter();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	return (
		<SidebarProvider>
			<Sidebar collapsible="icon">
				<SidebarHeader>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton tooltip="Night Shift">
								<span className="font-medium">Night Shift</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarHeader>
				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupLabel>Usage</SidebarGroupLabel>
						<SidebarMenu>
							{ITEMS.map((item) => (
								<SidebarMenuItem key={item.to}>
									<SidebarMenuButton
										tooltip={item.label}
										isActive={pathname === item.to}
										render={<Link to={item.to} />}
									>
										<item.icon aria-hidden="true" />
										<span>{item.label}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroup>
				</SidebarContent>
				<SidebarFooter>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton tooltip="Proof" render={<Link to="/proof" />}>
								<span>Proof</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
					{extra}
					<Button
						variant="outline"
						onClick={() => {
							void authClient.signOut().then(() => {
								void router.navigate({ to: "/login" });
							});
						}}
					>
						Sign out
					</Button>
				</SidebarFooter>
				<SidebarRail />
			</Sidebar>
			<SidebarInset className="min-w-0">{children}</SidebarInset>
		</SidebarProvider>
	);
}
