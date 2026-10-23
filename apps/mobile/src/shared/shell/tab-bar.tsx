import { NativeTabs } from "expo-router/native-tabs";

import { useThemeColors } from "@/shared/theme";
import { inboxTabLabel, type TabBarProps } from "./tabs";

/**
 * The four tabs on the system's own tab bar: on iOS 26 the floating Liquid
 * Glass bar, with SF Symbols. The chosen tab takes the theme's `primary`
 * (near black, near white in dark), not a brand color. The Inbox shows how
 * many Gates wait for you, in the system's badge color. Android has its own file (`tab-bar.android.tsx`).
 */
export function TabBar({ waiting }: TabBarProps) {
	const { colors } = useThemeColors();
	return (
		<NativeTabs
			// The badge keeps the system's color: waiting Gates are no error.
			tintColor={colors.primary}
		>
			<NativeTabs.Trigger name="index">
				<NativeTabs.Trigger.Icon
					sf={{ default: "house", selected: "house.fill" }}
				/>
				<NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger
				name="inbox"
				accessibilityLabel={inboxTabLabel(waiting)}
			>
				<NativeTabs.Trigger.Icon
					sf={{ default: "tray", selected: "tray.fill" }}
				/>
				<NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
				{/* No Badge, no badge: `hidden` and empty children leave a mark on iOS. */}
				{waiting > 0 ? (
					<NativeTabs.Trigger.Badge>{String(waiting)}</NativeTabs.Trigger.Badge>
				) : null}
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="runs">
				<NativeTabs.Trigger.Icon
					sf={{ default: "play.circle", selected: "play.circle.fill" }}
				/>
				<NativeTabs.Trigger.Label>Runs</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="projects">
				<NativeTabs.Trigger.Icon
					sf={{ default: "folder", selected: "folder.fill" }}
				/>
				<NativeTabs.Trigger.Label>Projects</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
