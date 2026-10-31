import { Tabs } from "expo-router";
import {
	FolderGit2,
	House,
	Inbox,
	type LucideIcon,
	Play,
} from "lucide-react-native";
import type { ColorValue } from "react-native";

import { useThemeColors } from "@/shared/theme";
import { inboxTabLabel, type TabBarProps } from "./tabs";

function icon(Icon: LucideIcon) {
	return ({ color, size }: { color: ColorValue; size: number }) => (
		<Icon color={color} size={size} />
	);
}

/**
 * The four tabs on Android: the JavaScript tab bar with lucide icons. The
 * native tabs of Android need `expo-symbols` or drawables for their icons,
 * which this app does not ship. Each tab is a stack with its own native
 * header (`TabStack`), which keeps the page below the status bar.
 */
export function TabBar({ waiting }: TabBarProps) {
	const { colors } = useThemeColors();
	return (
		<Tabs
			screenOptions={{
				headerShown: false,
				sceneStyle: { backgroundColor: colors.background },
				tabBarActiveTintColor: colors.primary,
				tabBarInactiveTintColor: colors.mutedForeground,
			}}
		>
			<Tabs.Screen
				name="(home)"
				options={{ title: "Home", tabBarIcon: icon(House) }}
			/>
			<Tabs.Screen
				name="inbox"
				options={{
					title: "Inbox",
					tabBarIcon: icon(Inbox),
					tabBarBadge: waiting > 0 ? waiting : undefined,
					tabBarAccessibilityLabel: inboxTabLabel(waiting),
				}}
			/>
			<Tabs.Screen
				name="runs"
				options={{ title: "Runs", tabBarIcon: icon(Play) }}
			/>
			<Tabs.Screen
				name="projects"
				options={{ title: "Projects", tabBarIcon: icon(FolderGit2) }}
			/>
		</Tabs>
	);
}
