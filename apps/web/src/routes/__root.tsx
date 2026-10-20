import {
	SidebarInset,
	SidebarProvider,
} from "@nightshift/ui/components/sidebar";
import { Toaster } from "@nightshift/ui/components/sonner";
import { TooltipProvider } from "@nightshift/ui/components/tooltip";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { ThemeProvider } from "next-themes";
import { useEffect } from "react";
import { accessRedirect, isOutsideApp } from "@/features/access";
import { orpc } from "@/shared/api";
import { AppSidebar, NightNotifications } from "@/shared/shell";

import appCss from "../index.css?url";
export interface RouterAppContext {
	orpc: typeof orpc;
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "Night Shift",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "/favicon.svg",
			},
		],
	}),

	component: RootDocument,
});

/**
 * Sends a browser that may not see the app yet to sign in, or to the
 * two-factor setup the Host requires, and back to this page after. Says
 * whether the app may show: not while the account is loading or a
 * redirect is due, so its calls do not fail one by one. When the account
 * does not load, the app shows and tells the person it cannot reach Night
 * Shift.
 */
function useAccessGuard(pathname: string, href: string): boolean {
	const navigate = useNavigate();
	const status = useQuery({
		...orpc.account.status.queryOptions(),
		meta: { quietErrors: true },
	});
	const target = status.data
		? accessRedirect(status.data, { pathname, href })
		: null;
	const to = target?.to;
	const redirect = target?.redirect;
	useEffect(() => {
		if (!to) return;
		void navigate({ to, search: { redirect }, replace: true });
	}, [to, redirect, navigate]);
	if (status.data) return target === null;
	// Not reached on the first try: show the app while the retries run.
	return status.failureCount > 0;
}

function RootDocument() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const href = useRouterState({ select: (s) => s.location.href });
	const outsideApp = isOutsideApp(pathname);
	const appMayShow = useAccessGuard(pathname, href);
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body>
				<ThemeProvider
					attribute="class"
					defaultTheme="dark"
					enableSystem
					disableTransitionOnChange
				>
					<TooltipProvider>
						{outsideApp ? (
							<Outlet />
						) : appMayShow ? (
							<SidebarProvider>
								<AppSidebar />
								<SidebarInset className="min-w-0">
									<Outlet />
								</SidebarInset>
							</SidebarProvider>
						) : null}
					</TooltipProvider>
					<Toaster richColors />
					{outsideApp || !appMayShow ? null : <NightNotifications />}
				</ThemeProvider>
				<TanStackRouterDevtools position="bottom-left" />
				<ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
				<Scripts />
			</body>
		</html>
	);
}
