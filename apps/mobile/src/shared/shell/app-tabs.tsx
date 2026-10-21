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
import { useLiveInbox, useWaitingCount } from "@/features/inbox";
import { SpacePicker, useRememberedSpace } from "@/features/spaces";

function icon(Icon: LucideIcon) {
	return ({ color, size }: { color: ColorValue; size: number }) => (
		<Icon color={color} size={size} />
	);
}

/** Runs and starting a flow are per Space: their headers choose it. */
const spacePicker = () => <SpacePicker />;

/**
 * The five tabs. Without a Host, or signed out, the person goes to the
 * connect screen first.
 */
export function AppTabs() {
	const { state } = useHost();
	if (state.status === "loading") return null;
	if (state.status === "signed-out") return <Redirect href="/connect" />;
	return <SignedInTabs />;
}

function SignedInTabs() {
	useRememberedSpace();
	useLiveInbox();
	const waiting = useWaitingCount();

	return (
		<Tabs>
			<Tabs.Screen
				name="index"
				options={{
					title: "Inbox",
					tabBarIcon: icon(Inbox),
					tabBarBadge: waiting > 0 ? waiting : undefined,
					tabBarAccessibilityLabel:
						waiting === 0
							? "Inbox"
							: waiting === 1
								? "Inbox, 1 Gate waits for you"
								: `Inbox, ${waiting} Gates wait for you`,
				}}
			/>
			<Tabs.Screen
				name="runs"
				options={{
					title: "Runs",
					tabBarIcon: icon(History),
					headerRight: spacePicker,
				}}
			/>
			<Tabs.Screen
				name="start"
				options={{
					title: "Start",
					tabBarIcon: icon(Play),
					headerRight: spacePicker,
				}}
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
