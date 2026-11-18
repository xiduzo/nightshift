import { useSyncExternalStore } from "react";
import { useThemeColors } from "@/shared/theme";
import { OUTCOME_HEX } from "@/shared/tone";
import { accessoryView, createBarStore } from "./needs-bar";

/** The bar of the thing on screen in Needs you. The page writes it, the bar above the tabs reads it. */
export const needsBar = createBarStore();

/**
 * What the bar above the tabs shows: where you are in Needs you, the
 * option you chose in its flow color (a value, for the native bar), and
 * Send. Null when nothing waits. `waiting` is the count of the tab badge.
 */
export function useNeedsAccessory(waiting: number) {
	const bar = useSyncExternalStore(needsBar.subscribe, needsBar.get);
	const { scheme } = useThemeColors();
	const view = accessoryView(bar, waiting);
	if (!view) return null;
	return {
		caption: view.caption,
		label: view.label,
		color: view.color ? OUTCOME_HEX[scheme][view.color] : undefined,
		short: view.short,
		action: view.action
			? { ...view.action, onPress: () => needsBar.send() }
			: null,
	};
}
