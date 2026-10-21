import {
	SidebarInset,
	SidebarProvider,
} from "@nightshift/ui/components/sidebar";
import { Toaster } from "@nightshift/ui/components/sonner";
import { TooltipProvider } from "@nightshift/ui/components/tooltip";
import { useRouterState } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { isOutsideApp, useAccessGuard } from "@/features/access";

import { AppSidebar } from "./app-sidebar";
import { NightNotifications } from "./use-night-notifications";
import { TabBadge } from "./use-tab-badge";

/**
 * The app frame around the page (`children`): the theme, the sidebar, the
 * toasts, the night notifications and the tab badge. A page outside the app (signing in)
 * shows without the sidebar. The app shows only when the access guard
 * lets it.
 */
export function AppShell({ children }: { children: ReactNode }) {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const href = useRouterState({ select: (s) => s.location.href });
	const outsideApp = isOutsideApp(pathname);
	const appMayShow = useAccessGuard(pathname, href);
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="dark"
			enableSystem
			disableTransitionOnChange
		>
			<TooltipProvider>
				{outsideApp ? (
					children
				) : appMayShow ? (
					<SidebarProvider>
						<AppSidebar />
						<SidebarInset className="min-w-0">{children}</SidebarInset>
					</SidebarProvider>
				) : null}
			</TooltipProvider>
			<Toaster richColors />
			{outsideApp || !appMayShow ? null : (
				<>
					<NightNotifications />
					<TabBadge />
				</>
			)}
		</ThemeProvider>
	);
}
