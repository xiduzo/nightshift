import "../../global.css";

import { Stack } from "expo-router";
import type { ComponentProps } from "react";

import { startPushHandling } from "@/features/push";
import { SpacePicker } from "@/features/spaces";
import { AppShell } from "@/shared/shell";

// Before any screen: iOS and Android start the app for a push in the
// background, and its task must be defined by then.
startPushHandling();

export const unstable_settings = {
	anchor: "(tabs)",
};

/** A secondary view as a native sheet: half the screen, or all of it. */
const sheet = {
	presentation: "formSheet",
	sheetAllowedDetents: [0.6, 1],
	sheetGrabberVisible: true,
	headerShown: false,
} satisfies ComponentProps<typeof Stack.Screen>["options"];

/** Starting a run is per Space: its header chooses it. */
const spacePicker = () => <SpacePicker />;

export default function RootLayout() {
	return (
		<AppShell>
			<Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
				<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
				<Stack.Screen name="connect" options={{ title: "Connect" }} />
				<Stack.Screen name="runs/[runId]" options={{ title: "Run" }} />
				<Stack.Screen
					name="gates/[runId]/[stepId]"
					options={{ title: "Gate", presentation: "modal" }}
				/>
				<Stack.Screen
					name="projects/[projectId]"
					options={{ title: "Project" }}
				/>
				<Stack.Screen name="settings" options={{ title: "Settings" }} />
				<Stack.Screen
					name="start"
					options={{
						title: "New run",
						presentation: "modal",
						headerRight: spacePicker,
					}}
				/>
				<Stack.Screen
					name="search"
					options={{ ...sheet, sheetAllowedDetents: [1] }}
				/>
				<Stack.Screen name="flows" options={sheet} />
				<Stack.Screen name="computers" options={sheet} />
			</Stack>
		</AppShell>
	);
}
