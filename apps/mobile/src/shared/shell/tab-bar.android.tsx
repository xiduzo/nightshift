import { Tabs } from "expo-router";
import { Hand, type LucideIcon, Moon } from "lucide-react-native";
import { type ColorValue, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useThemeColors } from "@/shared/theme";
import type { TabBarProps } from "./tabs";

function icon(Icon: LucideIcon) {
	return ({ color, size }: { color: ColorValue; size: number }) => (
		<Icon color={color} size={size} />
	);
}

/**
 * The two tabs on Android: the JavaScript tab bar with lucide icons. The
 * native tabs of Android need `expo-symbols` or drawables for their icons,
 * which this app does not ship. Each tab is a stack with its own native
 * header (`TabStack`), which keeps the page below the status bar.
 */
/** The tab bar without the system inset, in dp. */
const BAR_HEIGHT = 64;

/**
 * The accessory (what waits, and Send) floats 12 dp above the tab bar,
 * as a Material floating toolbar.
 */
export function TabBar({ waiting, needsLabel, accessory }: TabBarProps) {
	const { colors } = useThemeColors();
	const insets = useSafeAreaInsets();
	// A known height, so the accessory can float just above the bar.
	const barHeight = BAR_HEIGHT + insets.bottom;
	return (
		<View style={{ flex: 1 }}>
			<Tabs
				screenOptions={{
					headerShown: false,
					sceneStyle: { backgroundColor: colors.background },
					tabBarActiveTintColor: colors.primary,
					tabBarInactiveTintColor: colors.mutedForeground,
					tabBarStyle: { height: barHeight },
				}}
			>
				<Tabs.Screen
					name="(needs)"
					options={{
						title: "Needs you",
						tabBarIcon: icon(Hand),
						tabBarBadge: waiting > 0 ? waiting : undefined,
						tabBarAccessibilityLabel: needsLabel,
					}}
				/>
				<Tabs.Screen
					name="runs"
					options={{ title: "Runs", tabBarIcon: icon(Moon) }}
				/>
			</Tabs>
			{accessory ? (
				<View
					pointerEvents="box-none"
					className="absolute right-0 left-0 items-center"
					style={{ bottom: barHeight + 12 }}
				>
					{accessory}
				</View>
			) : null}
		</View>
	);
}
