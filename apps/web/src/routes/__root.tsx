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
import { AppSidebar } from "@/components/app-sidebar";
import { NightNotifications } from "@/hooks/use-night-notifications";
import { orpc } from "@/utils/orpc";

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
 * Pages for someone who is not signed in yet (signing in, an invitation's
 * link), and the two-factor setup a Host may require first. They show
 * without the app's sidebar.
 */
const OUTSIDE_APP = ["/login", "/invite/", "/two-factor"];

/** Pages a session may see before it turns on the two-factor sign-in the Host requires. */
const BEFORE_TWO_FACTOR = ["/login", "/two-factor"];

/**
 * Sends a session the Host refuses until it turns two-factor on to the
 * setup page, and back to this page after.
 */
function TwoFactorGuard({ pathname }: { pathname: string }) {
	const navigate = useNavigate();
	const status = useQuery({
		...orpc.account.status.queryOptions(),
		meta: { quietErrors: true },
	});
	const needed = status.data?.twoFactor.setUpNeeded === true;
	useEffect(() => {
		if (!needed) return;
		if (BEFORE_TWO_FACTOR.some((prefix) => pathname.startsWith(prefix))) return;
		void navigate({ to: "/two-factor", search: { redirect: pathname } });
	}, [needed, pathname, navigate]);
	return null;
}

function RootDocument() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const outsideApp = OUTSIDE_APP.some((prefix) => pathname.startsWith(prefix));
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
						) : (
							<SidebarProvider>
								<AppSidebar />
								<SidebarInset className="min-w-0">
									<Outlet />
								</SidebarInset>
							</SidebarProvider>
						)}
					</TooltipProvider>
					<Toaster richColors />
					<TwoFactorGuard pathname={pathname} />
					{outsideApp ? null : <NightNotifications />}
				</ThemeProvider>
				<TanStackRouterDevtools position="bottom-left" />
				<ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
				<Scripts />
			</body>
		</html>
	);
}
