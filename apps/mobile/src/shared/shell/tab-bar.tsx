import { NativeTabs } from "expo-router/native-tabs";

import { useThemeColors } from "@/shared/theme";
import type { TabBarProps } from "./tabs";

/**
 * The two tabs on the system's own tab bar: on iOS 26 the floating
 * Liquid Glass bar, with SF Symbols. Needs you answers "does something
 * need me now", Runs "what runs now and tonight". How the runs went is
 * the work of the desktop and web app, not of the phone. The chosen
 * tab takes the theme's `primary` (near black, near white in dark), not a
 * brand color. Needs you shows how many things wait, in the system's
 * badge color. Android has its own file (`tab-bar.android.tsx`).
 */
export function TabBar({ waiting, needsLabel, accessory }: TabBarProps) {
	const { colors } = useThemeColors();
	return (
		<NativeTabs
			// The badge keeps the system's color: what waits is no error.
			tintColor={colors.primary}
		>
			{accessory ? (
				<NativeTabs.BottomAccessory>{accessory}</NativeTabs.BottomAccessory>
			) : null}
			<NativeTabs.Trigger name="(needs)" accessibilityLabel={needsLabel}>
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
				<NativeTabs.Trigger.Icon
					sf={{ default: "moon", selected: "moon.fill" }}
				/>
				<NativeTabs.Trigger.Label>Runs</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
