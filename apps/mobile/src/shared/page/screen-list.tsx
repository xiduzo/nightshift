import { FlashList, type FlashListProps } from "@shopify/flash-list";
import type { ReactNode } from "react";
import { View } from "react-native";

import { useThemeColors } from "@/shared/theme";
import { PAGE_SCROLL, Summary, useRefreshControl } from "./screen";

type ScreenListProps<T> = Omit<
	FlashListProps<T>,
	| "ListHeaderComponent"
	| "refreshControl"
	| "contentContainerStyle"
	| "contentInsetAdjustmentBehavior"
> & {
	/** Pull to refresh: reads the screen's data again. */
	onRefresh?: () => Promise<unknown>;
	/** The muted line under the native title, as on `Screen`. */
	summary?: string;
	/** The standardized time of that line, for the screen reader. */
	summaryHint?: string;
	/**
	 * What comes above the rows: the native header parts (search, toolbar),
	 * chips, a card. A loading, error or empty state goes here too, with no
	 * rows, so every state of the screen keeps the same list as its root.
	 */
	header?: ReactNode;
};

/**
 * A screen that is one long list: `Screen` as a FlashList. Return it as
 * the root of the screen, so it is the first native child and the large
 * title collapses. Each row renders and recycles on its own: draw it as a
 * ListCell (the card look) split by `ItemSeparatorComponent={CellSeparator}`.
 * Rows are `memo`, and `renderItem`, `keyExtractor` and `getItemType` are
 * stable (module level, or `useCallback`).
 */
export function ScreenList<T>({
	onRefresh,
	summary,
	summaryHint,
	header,
	...list
}: ScreenListProps<T>) {
	const { colors } = useThemeColors();
	const refreshControl = useRefreshControl(onRefresh);
	return (
		<FlashList
			{...PAGE_SCROLL}
			// iOS: a field near the bottom scrolls above the keyboard.
			automaticallyAdjustKeyboardInsets
			style={{ flex: 1, backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 16 }}
			refreshControl={refreshControl}
			ListHeaderComponent={
				<View className="gap-4 pb-4">
					<Summary text={summary} hint={summaryHint} />
					{header}
				</View>
			}
			{...list}
		/>
	);
}
