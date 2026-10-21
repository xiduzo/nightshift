import { THEME } from "@nightshift/ui-native/lib/theme";
import { type ReactNode, useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { useUniwind } from "uniwind";

type ScreenProps = {
	children: ReactNode;
	/** Pull to refresh: reads the screen's data again. */
	onRefresh?: () => Promise<unknown>;
};

/**
 * The body of a screen: scrolls, on the theme's background. It starts
 * below the header and above the tab bar, which iOS draws translucent over it.
 */
export function Screen({ children, onRefresh }: ScreenProps) {
	const [refreshing, setRefreshing] = useState(false);
	const { theme } = useUniwind();

	async function refresh() {
		if (!onRefresh) return;
		setRefreshing(true);
		try {
			await onRefresh();
		} finally {
			setRefreshing(false);
		}
	}

	return (
		<ScrollView
			className="flex-1 bg-background"
			contentContainerClassName="flex-grow gap-4 p-4"
			contentInsetAdjustmentBehavior="automatic"
			keyboardShouldPersistTaps="handled"
			refreshControl={
				onRefresh ? (
					<RefreshControl
						refreshing={refreshing}
						onRefresh={refresh}
						tintColor={
							THEME[theme === "dark" ? "dark" : "light"].mutedForeground
						}
					/>
				) : undefined
			}
		>
			{children}
		</ScrollView>
	);
}
