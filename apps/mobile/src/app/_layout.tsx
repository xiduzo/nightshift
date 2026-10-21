import "../../global.css";

import { Stack } from "expo-router";

import { AppShell } from "@/shared/shell";

export const unstable_settings = {
	anchor: "(tabs)",
};

export default function RootLayout() {
	return (
		<AppShell>
			<Stack>
				<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
				<Stack.Screen name="connect" options={{ title: "Connect" }} />
			</Stack>
		</AppShell>
	);
}
