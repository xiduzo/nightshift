import { Tabs } from "expo-router";
import { Hand, History, type LucideIcon, Moon } from "lucide-react-native";
import type { ColorValue } from "react-native";

import { useThemeColors } from "@/shared/theme";
import type { TabBarProps } from "./tabs";

function icon(Icon: LucideIcon) {
	return ({ color, size }: { color: ColorValue; size: number }) => (
		<Icon color={color} size={size} />
	);
}

/**
 * The three tabs on Android: the JavaScript tab bar with lucide icons. The
 * native tabs of Android need `expo-symbols` or drawables for their icons,
 * which this app does not ship. Each tab is a stack with its own native
 * header (`TabStack`), which keeps the page below the status bar.
 */
export function TabBar({ waiting, needsLabel }: TabBarProps) {
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
				name="(watch)"
				options={{ title: "Watch", tabBarIcon: icon(Moon) }}
			/>
			<Tabs.Screen
				name="needs"
				options={{
					title: "Needs you",
					tabBarIcon: icon(Hand),
					tabBarBadge: waiting > 0 ? waiting : undefined,
					tabBarAccessibilityLabel: needsLabel,
				}}
			/>
			<Tabs.Screen
				name="runs"
				options={{ title: "Runs", tabBarIcon: icon(History) }}
			/>
		</Tabs>
	);
}
