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
