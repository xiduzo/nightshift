import type { ReactNode } from "react";

export type TabBarProps = {
	/** Everything that waits for the person: the Needs you badge. */
	waiting: number;
	/** What a screen reader says for the Needs you tab. */
	needsLabel: string;
	/**
	 * What stays above the tabs on every tab: what waits for you, and Send.
	 * iOS 26 shows it in the tab bar accessory, Android above the tab bar.
	 */
	accessory?: ReactNode;
};

/** The bar above the tabs: what waits for you, the option you chose, and Send. */
export type AccessoryBarProps = {
	/** "2 of 5 · Daily digest". Null before Needs you shows a thing. */
	caption: string | null;
	/** The option you chose, or what to do: "Choose an answer". */
	label: string;
	/** The flow color of the option you chose, as a value. */
	color?: string;
	/** The bar made small (iOS, while you scroll): "3 things wait for you". */
	short: string;
	/** Send. Null when you cannot send from the bar. */
	action: { label: string; disabled: boolean; onPress: () => void } | null;
};
