import { type ReactNode, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useThemeColors } from "@/shared/theme";

type ScreenProps = {
	children: ReactNode;
	/** Pull to refresh: reads the screen's data again. */
	onRefresh?: () => Promise<unknown>;
	/**
	 * What stays at the bottom while the body scrolls: an ActionBar. It
	 * sits above the home indicator; the body ends above it.
	 */
	footer?: ReactNode;
};

/**
 * The body of a screen: scrolls, on the theme's `background`, with 16 pt
 * at the sides and 16 pt between its parts. Cards on it are `card`, as on
 * the desktop app. It starts below the status bar (or the header) and
 * ends above the tab bar, which iOS draws translucent over it.
 */
export function Screen({ children, onRefresh, footer }: ScreenProps) {
	const [refreshing, setRefreshing] = useState(false);
	const { colors } = useThemeColors();
	const insets = useSafeAreaInsets();

	async function refresh() {
		if (!onRefresh) return;
		setRefreshing(true);
		try {
			await onRefresh();
		} finally {
			setRefreshing(false);
		}
	}

	const body = (
		<ScrollView
			className="flex-1 bg-background"
			contentContainerClassName="flex-grow gap-4 p-4"
			contentInsetAdjustmentBehavior="automatic"
			// iOS: a field near the bottom (a Gate's note) scrolls above the keyboard.
			automaticallyAdjustKeyboardInsets
			keyboardShouldPersistTaps="handled"
			refreshControl={
				onRefresh ? (
					<RefreshControl
						refreshing={refreshing}
						onRefresh={refresh}
						tintColor={colors.mutedForeground}
					/>
				) : undefined
			}
		>
			{children}
		</ScrollView>
	);
	if (!footer) return body;
	return (
		<View className="flex-1 bg-background">
			{body}
			<View
				className="px-4 pt-2"
				style={{ paddingBottom: Math.max(insets.bottom, 16) }}
			>
				{footer}
			</View>
		</View>
	);
}
