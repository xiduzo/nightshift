import { useCallback, useState } from "react";

import { useThemeColors } from "@/shared/theme";

/**
 * Pull to refresh for a list that is not a `Screen`: the props of its
 * `RefreshControl`. The spinner shows only for a pull, not for a poll.
 */
export function usePullRefresh(refetch: () => Promise<unknown>): {
	refreshing: boolean;
	onRefresh: () => void;
	tintColor: string;
} {
	const [refreshing, setRefreshing] = useState(false);
	const { colors } = useThemeColors();
	const onRefresh = useCallback(() => {
		setRefreshing(true);
		void refetch().finally(() => setRefreshing(false));
	}, [refetch]);
	return {
		refreshing,
		onRefresh,
		tintColor: colors.mutedForeground,
	};
}
