import { TooltipProvider } from "@nightshift/ui/components/tooltip";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";

export const Route = createRootRoute({
	component: Root,
});

function Root() {
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="dark"
			enableSystem
			disableTransitionOnChange
		>
			<TooltipProvider>
				<Outlet />
			</TooltipProvider>
		</ThemeProvider>
	);
}
