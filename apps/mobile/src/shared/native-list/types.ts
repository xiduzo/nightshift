import type { ButtonProps } from "@expo/ui/swift-ui";
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";

export type SFSymbol = NonNullable<ButtonProps["systemImage"]>;

/**
 * An icon on both platforms: an SF Symbol on iOS, a lucide icon on
 * Android (drawn in the Compose row through an RN host view).
 */
export type NativeIcon = { sf: SFSymbol; lucide: LucideIcon };

/** One action on a row: a swipe on iOS, an item of the long-press menu on Android. */
export type RowAction = {
	label: string;
	icon: NativeIcon;
	onPress: () => void;
	destructive?: boolean;
	/** The swipe color on iOS. A destructive action is red. */
	color?: string;
	/** iOS: the edge the swipe reveals it from. Trailing by default. */
	edge?: "leading" | "trailing";
};

export type NativeListProps = {
	children: ReactNode;
	/** Pull to refresh: reads the screen's data again. */
	onRefresh?: () => Promise<unknown>;
};

export type NativeSectionProps = {
	/** The small head above the group. */
	title?: string;
	/** A muted line under the group: a hint, a limit. */
	footer?: string;
	children: ReactNode;
};

export type NativeRowProps = {
	title: string;
	/** A small muted line above the title. */
	overline?: string;
	/** A muted line under the title. */
	subtitle?: string;
	/** A short value at the end: "12 min", "23:00". */
	value?: string;
	icon?: NativeIcon;
	/** The icon's color (a value, not a class). */
	iconColor?: string;
	/** The title in a color: a flow color, a status. */
	titleColor?: string;
	/** The row is dimmed: a paused schedule. */
	muted?: boolean;
	onPress?: () => void;
	/** A chevron at the end: the row opens a screen. Default: on with onPress. */
	chevron?: boolean;
	actions?: readonly RowAction[];
	/** The whole row as a screen reader says it. */
	accessibilityLabel?: string;
};

/** The head of a page as one row: where it is from, the title, a status line. */
export type NativeTitleRowProps = {
	overline?: string;
	title: string;
	/** The status and the facts under the title. */
	caption?: string;
	captionColor?: string;
};

/** A paragraph: Situation, Why it stopped. Markdown is inline only (bold, links). */
export type NativeTextRowProps = {
	text: string;
	secondary?: boolean;
	/** A source or a note under the text. */
	note?: string;
	icon?: NativeIcon;
	iconColor?: string;
	/** iOS: touch and hold to select and copy the text. */
	selectable?: boolean;
};

/** One option you pick, in its flow color, with what happens when you pick it. */
export type NativeOptionRowProps = {
	title: string;
	subtitle?: string;
	color?: string;
	selected: boolean;
	recommended?: boolean;
	disabled?: boolean;
	onPress: () => void;
};

export type NativeToggleRowProps = {
	title: string;
	subtitle?: string;
	value: boolean;
	onChange: (value: boolean) => void;
	disabled?: boolean;
};

export type NativePickerRowProps = {
	title: string;
	value: string;
	options: readonly { value: string; label: string }[];
	onChange: (value: string) => void;
	disabled?: boolean;
};

export type NativeButtonRowProps = {
	label: string;
	icon?: NativeIcon;
	destructive?: boolean;
	disabled?: boolean;
	onPress: () => void;
};

/** A row that says what loads, with the platform's spinner. */
export type NativeLoadingRowProps = { label: string };

/** Any React Native content in a row, for what the kit does not cover: a Markdown body, a chart. */
export type NativeCustomRowProps = { children: ReactNode };
