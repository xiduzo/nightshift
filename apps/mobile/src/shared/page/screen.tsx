import { Text } from "@nightshift/ui-native/components/ui/text";
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
	 * One muted line at the top, under the native title: "3 Gates need
	 * you · 2 Spaces". The native header has no room for it.
	 */
	summary?: string;
	/**
	 * What stays at the bottom while the body scrolls: an ActionBar. It
	 * sits above the home indicator, and above the keyboard while one is
	 * open; the body ends above it.
	 */
	footer?: ReactNode;
};

/**
 * The props every scroll view of a page takes, so the native header and
 * the tab bar work with it. The scroll view is the first child of the
 * screen, and `automatic` insets let the large title collapse on scroll
 * (iOS) and keep the end of the page above the tab bar. A list that takes
 * over a page (FlashList) takes the same props and the same refresh
 * control, and is the first child too.
 */
const PAGE_SCROLL = {
	contentInsetAdjustmentBehavior: "automatic",
	keyboardShouldPersistTaps: "handled",
	// Drag the page down to put the keyboard away.
	keyboardDismissMode: "interactive",
} as const;

/** Pull to refresh in the theme's muted color, while `onRefresh` works. */
function useRefreshControl(onRefresh: (() => Promise<unknown>) | undefined) {
	const [refreshing, setRefreshing] = useState(false);
	const { colors } = useThemeColors();
	if (!onRefresh) return undefined;
	const refresh = async () => {
		setRefreshing(true);
		try {
			await onRefresh();
		} finally {
			setRefreshing(false);
		}
	};
	return (
		<RefreshControl
			refreshing={refreshing}
			onRefresh={refresh}
			tintColor={colors.mutedForeground}
		/>
	);
}

/** The muted line under the native title. */
function Summary({ text }: { text: string | undefined }) {
	if (!text) return null;
	return <Text className="text-muted-foreground text-sm">{text}</Text>;
}

/**
 * The body of a screen: scrolls, on the theme's `background`, with 16 pt
 * at the sides and 16 pt between its parts. Cards on it are `card`, as on
 * the desktop app. The native header holds the title and the actions. The
 * body starts below the header and ends above the tab bar, which iOS
 * draws translucent over it.
 */
export function Screen({ children, onRefresh, summary, footer }: ScreenProps) {
	const [footerHeight, setFooterHeight] = useState(0);
	const { colors } = useThemeColors();
	const insets = useSafeAreaInsets();
	const refreshControl = useRefreshControl(onRefresh);

	if (!footer) {
		return (
			<ScrollView
				{...PAGE_SCROLL}
				className="flex-1 bg-background"
				contentContainerClassName="flex-grow gap-4 p-4"
				// iOS: a field near the bottom scrolls above the keyboard.
				automaticallyAdjustKeyboardInsets
				refreshControl={refreshControl}
			>
				<Summary text={summary} />
				{children}
			</ScrollView>
		);
	}

	// With a footer, the bar rides on the keyboard, and a focused field (a
	// Gate's note) scrolls above the bar. Closed, the bar ends above the
	// home indicator. Open, it sits a small gap above the keyboard: the
	// keyboard covers the home indicator already.
	const gap = 8;
	return (
		<View className="flex-1 bg-background">
			<KeyboardAwareScrollView
				{...PAGE_SCROLL}
				style={{ flex: 1, backgroundColor: colors.background }}
				contentContainerStyle={{ flexGrow: 1, gap: 16, padding: 16 }}
				bottomOffset={footerHeight + gap}
				refreshControl={refreshControl}
			>
				<Summary text={summary} />
				{children}
			</KeyboardAwareScrollView>
			<KeyboardStickyView
				offset={{ opened: insets.bottom }}
				onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
			>
				<View
					className="px-4 pt-2"
					style={{ paddingBottom: insets.bottom + gap }}
				>
					{footer}
				</View>
			</KeyboardStickyView>
		</View>
	);
}
