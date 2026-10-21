import { PortalHost } from "@rn-primitives/portal";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useUniwind } from "uniwind";

import { HostProvider } from "@/features/host";
import { createQueryClient } from "@/shared/api";
import { NAV_THEME } from "./nav-theme";

/**
 * The app frame: data, the Host, the theme, gestures and the
 * keyboard. Portals (menus, dialogs) render last, above everything.
 */
export function AppShell({ children }: { children: ReactNode }) {
	const [queryClient] = useState(createQueryClient);
	const { theme } = useUniwind();
	const scheme = theme === "dark" ? "dark" : "light";

	return (
		<QueryClientProvider client={queryClient}>
			<HostProvider>
				<GestureHandlerRootView style={{ flex: 1 }}>
					<KeyboardProvider>
						<ThemeProvider value={NAV_THEME[scheme]}>
							<StatusBar style={scheme === "dark" ? "light" : "dark"} />
							{children}
							<PortalHost />
						</ThemeProvider>
					</KeyboardProvider>
				</GestureHandlerRootView>
			</HostProvider>
		</QueryClientProvider>
	);
}
