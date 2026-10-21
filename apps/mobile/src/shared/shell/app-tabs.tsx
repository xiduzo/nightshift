import { Redirect, Tabs } from "expo-router";
import {
	History,
	Inbox,
	LayoutDashboard,
	type LucideIcon,
	Play,
	Settings,
} from "lucide-react-native";
import type { ColorValue } from "react-native";

import { useHost } from "@/features/host";

function icon(Icon: LucideIcon) {
	return ({ color, size }: { color: ColorValue; size: number }) => (
		<Icon color={color} size={size} />
	);
}

/**
 * The five tabs. Without a Host, or signed out, the person goes to the
 * connect screen first.
 */
export function AppTabs() {
	const { state } = useHost();
	if (state.status === "loading") return null;
	if (state.status === "signed-out") return <Redirect href="/connect" />;

	return (
		<Tabs>
			<Tabs.Screen
				name="index"
				options={{ title: "Inbox", tabBarIcon: icon(Inbox) }}
			/>
			<Tabs.Screen
				name="runs"
				options={{ title: "Runs", tabBarIcon: icon(History) }}
			/>
			<Tabs.Screen
				name="start"
				options={{ title: "Start", tabBarIcon: icon(Play) }}
			/>
			<Tabs.Screen
				name="dashboard"
				options={{ title: "Dashboard", tabBarIcon: icon(LayoutDashboard) }}
			/>
			<Tabs.Screen
				name="settings"
				options={{ title: "Settings", tabBarIcon: icon(Settings) }}
			/>
		</Tabs>
	);
}
