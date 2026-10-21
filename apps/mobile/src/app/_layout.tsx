import "../../global.css";

import { Stack } from "expo-router";

import { startPushHandling } from "@/features/push";
import { AppShell } from "@/shared/shell";

// Before any screen: iOS and Android start the app for a push in the
// background, and its task must be defined by then.
startPushHandling();

export const unstable_settings = {
	anchor: "(tabs)",
};

export default function RootLayout() {
	return (
		<AppShell>
			<Stack>
				<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
				<Stack.Screen name="connect" options={{ title: "Connect" }} />
				<Stack.Screen
					name="runs/[runId]"
					options={{ title: "Run", headerBackButtonDisplayMode: "minimal" }}
				/>
				<Stack.Screen
					name="gates/[runId]/[stepId]"
					options={{ title: "Gate", presentation: "modal" }}
				/>
			</Stack>
		</AppShell>
	);
}
