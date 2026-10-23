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
/**
 * iOS 26 puts a glass pill behind a header item. The picker is a bordered
 * Select already, so it goes without the pill.
 */
const spacePickerItems = () => [
	{
		type: "custom" as const,
		element: <SpacePicker />,
		hidesSharedBackground: true,
	},
];

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
						unstable_headerRightItems: spacePickerItems,
					}}
				/>
				<Stack.Screen
					name="search"
					options={{ ...sheet, sheetAllowedDetents: [1] }}
				/>
				<Stack.Screen name="flows" options={sheet} />
				<Stack.Screen name="computers" options={sheet} />
				<Stack.Screen name="inbox-filter" options={sheet} />
				<Stack.Screen name="gate-link" options={sheet} />
				<Stack.Screen name="gate-actions" options={sheet} />
				<Stack.Screen name="transcript/[runId]" options={sheet} />
			</Stack>
		</AppShell>
	);
}
