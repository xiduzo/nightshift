import "../../global.css";

import { Stack } from "expo-router";
import type { ComponentProps } from "react";
import { Platform } from "react-native";

import { startPushHandling } from "@/features/push";
import { AppShell } from "@/shared/shell";

// Before any screen: iOS and Android start the app for a push in the
// background, and its task must be defined by then.
startPushHandling();

export const unstable_settings = {
	anchor: "(tabs)",
};

type Options = NonNullable<ComponentProps<typeof Stack.Screen>["options"]>;

/**
 * A secondary view with its title in the native header. On iOS a sheet:
 * half the screen, or all of it. Android shows no header in a sheet, so
 * there it is a modal with a top app bar and a back arrow.
 */
function sheet(title: string, detents: number[] = [0.6, 1]): Options {
	return Platform.OS === "ios"
		? {
				title,
				presentation: "formSheet",
				sheetAllowedDetents: detents,
				sheetGrabberVisible: true,
			}
		: { title, presentation: "modal" };
}

export default function RootLayout() {
	return (
		<AppShell>
			<Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
				<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
				<Stack.Screen
					name="connect"
					options={{ title: "Connect", headerLargeTitleEnabled: true }}
				/>
				<Stack.Screen name="runs/[runId]" options={{ title: "Run" }} />
				<Stack.Screen
					name="changes/[runId]"
					options={{ title: "Changed files" }}
				/>
				<Stack.Screen
					name="gates/[runId]/[stepId]"
					options={{ title: "Gate", presentation: "modal" }}
				/>
				<Stack.Screen
					name="projects/[projectId]"
					options={{ title: "Project", headerLargeTitleEnabled: true }}
				/>
				<Stack.Screen
					name="settings"
					options={{ title: "Settings", headerLargeTitleEnabled: true }}
				/>
				<Stack.Screen
					name="start"
					options={{ title: "New run", presentation: "modal" }}
				/>
				<Stack.Screen name="computers" options={sheet("Computers")} />
				<Stack.Screen name="gate-link" options={sheet("Link")} />
				<Stack.Screen name="gate-actions" options={sheet("Gate actions")} />
				<Stack.Screen name="transcript/[runId]" options={sheet("Transcript")} />
			</Stack>
		</AppShell>
	);
}
