import { PortalHost } from "@rn-primitives/portal";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { HostProvider } from "@/features/host";
import { InFrontBanner, useNotificationTaps } from "@/features/push";
import { createQueryClient } from "@/shared/api";
import { applyKeptAppearance, useThemeColors } from "@/shared/theme";
import { NAV_THEME } from "./nav-theme";

// Before the first screen: the appearance the person chose on this phone.
applyKeptAppearance();

/**
 * The app frame: data, the Host, the theme, gestures and the
 * keyboard. A tap on a notification opens its screen. The banner of a
 * push in front and the portals (menus, dialogs) render last, above
 * everything. The theme follows the appearance in Settings.
 */
export function AppShell({ children }: { children: ReactNode }) {
	useNotificationTaps();
	const [queryClient] = useState(createQueryClient);
	const { scheme } = useThemeColors();

	return (
		<QueryClientProvider client={queryClient}>
			<HostProvider>
				<GestureHandlerRootView style={{ flex: 1 }}>
					<KeyboardProvider>
						<ThemeProvider value={NAV_THEME[scheme]}>
							<StatusBar style={scheme === "dark" ? "light" : "dark"} />
							{children}
							<InFrontBanner />
							<PortalHost />
						</ThemeProvider>
					</KeyboardProvider>
				</GestureHandlerRootView>
			</HostProvider>
		</QueryClientProvider>
	);
}
