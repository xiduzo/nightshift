import { type ReactNode, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import {
	KeyboardAwareScrollView,
	KeyboardStickyView,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useThemeColors } from "@/shared/theme";

type ScreenProps = {
	children: ReactNode;
	/** Pull to refresh: reads the screen's data again. */
	onRefresh?: () => Promise<unknown>;
	/**
	 * What stays at the bottom while the body scrolls: an ActionBar. It
	 * sits above the home indicator, and above the keyboard while one is
	 * open; the body ends above it.
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
	const [footerHeight, setFooterHeight] = useState(0);
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

	const refreshControl = onRefresh ? (
		<RefreshControl
			refreshing={refreshing}
			onRefresh={refresh}
			tintColor={colors.mutedForeground}
		/>
	) : undefined;

	if (!footer) {
		return (
			<ScrollView
				className="flex-1 bg-background"
				contentContainerClassName="flex-grow gap-4 p-4"
				contentInsetAdjustmentBehavior="automatic"
				// iOS: a field near the bottom scrolls above the keyboard.
				automaticallyAdjustKeyboardInsets
				keyboardShouldPersistTaps="handled"
				// Drag the page down to put the keyboard away.
				keyboardDismissMode="interactive"
				refreshControl={refreshControl}
			>
				{children}
			</ScrollView>
		);
	}

	// With a footer, the bar rides on the keyboard, and a focused field (a
	// Gate's note) scrolls above the bar. `bottom` is the gap under the bar.
	const bottom = Math.max(insets.bottom, 16);
	return (
		<View className="flex-1 bg-background">
			<KeyboardAwareScrollView
				style={{ flex: 1, backgroundColor: colors.background }}
				contentContainerStyle={{ flexGrow: 1, gap: 16, padding: 16 }}
				contentInsetAdjustmentBehavior="automatic"
				bottomOffset={footerHeight + 16}
				keyboardShouldPersistTaps="handled"
				keyboardDismissMode="interactive"
				refreshControl={refreshControl}
			>
				{children}
			</KeyboardAwareScrollView>
			<KeyboardStickyView
				// Over the keyboard, the bar needs no room for the home indicator.
				offset={{ opened: bottom - 8 }}
				onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
			>
				<View className="px-4 pt-2" style={{ paddingBottom: bottom }}>
					{footer}
				</View>
			</KeyboardStickyView>
		</View>
	);
}
