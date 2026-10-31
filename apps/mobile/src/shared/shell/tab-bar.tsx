import { NativeTabs } from "expo-router/native-tabs";

import { useThemeColors } from "@/shared/theme";
import type { TabBarProps } from "./tabs";

/**
 * The three tabs on the system's own tab bar: on iOS 26 the floating
 * Liquid Glass bar, with SF Symbols. Watch answers "how did it go",
 * Needs you "does something need me", Runs holds every run. The chosen
 * tab takes the theme's `primary` (near black, near white in dark), not a
 * brand color. Needs you shows how many things wait, in the system's
 * badge color. Android has its own file (`tab-bar.android.tsx`).
 */
export function TabBar({ waiting, needsLabel }: TabBarProps) {
	const { colors } = useThemeColors();
	return (
		<NativeTabs
			// The badge keeps the system's color: what waits is no error.
			tintColor={colors.primary}
		>
			<NativeTabs.Trigger name="(watch)">
				<NativeTabs.Trigger.Icon
					sf={{ default: "moon", selected: "moon.fill" }}
				/>
				<NativeTabs.Trigger.Label>Watch</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="needs" accessibilityLabel={needsLabel}>
				<NativeTabs.Trigger.Icon
					sf={{ default: "hand.raised", selected: "hand.raised.fill" }}
				/>
				<NativeTabs.Trigger.Label>Needs you</NativeTabs.Trigger.Label>
				{/* No Badge, no badge: `hidden` and empty children leave a mark on iOS. */}
				{waiting > 0 ? (
					<NativeTabs.Trigger.Badge>{String(waiting)}</NativeTabs.Trigger.Badge>
				) : null}
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="runs">
				<NativeTabs.Trigger.Icon sf="clock.arrow.circlepath" />
				<NativeTabs.Trigger.Label>Runs</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
