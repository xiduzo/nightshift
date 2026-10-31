import { Stack } from "expo-router";

/**
 * The stack of one tab, with the native header. On iOS the title is
 * large and collapses into the bar when the page scrolls. iOS 26 draws the
 * bar as glass over the page. Android shows its own top app bar. Each
 * tab route folder (`(tabs)/inbox/_layout.tsx`) is one of these.
 */
export function TabStack({ title }: { title: string }) {
	return (
		<Stack
			screenOptions={{
				headerLargeTitleEnabled: true,
				headerLargeTitleShadowVisible: false,
				headerShadowVisible: false,
				headerBackButtonDisplayMode: "minimal",
			}}
		>
			<Stack.Screen name="index" options={{ title }} />
		</Stack>
	);
}
