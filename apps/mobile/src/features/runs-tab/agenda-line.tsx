import { formatTime } from "@nightshift/client";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import type { ReactNode } from "react";
import { type AccessibilityActionEvent, Pressable, View } from "react-native";

import { lineLabel, type Rail } from "./agenda";

const RAIL: Record<Rail, string> = {
	running: "bg-status-running",
	offline: "bg-destructive",
	quiet: "bg-border",
};

/**
 * One line of the agenda: the time in its own column, a thin line in the
 * color of what it is, the title and one caption, and one button at the
 * end. The button sits next to the line, not in it, so a screen reader
 * reaches both.
 */
export function AgendaLine({
	at,
	title,
	caption,
	rail,
	muted = false,
	action,
	onPress,
	onPressIn,
	onLongPress,
	longPressLabel,
	accessibilityHint,
}: {
	at: number | null;
	title: string;
	caption: string;
	rail: Rail;
	muted?: boolean;
	/** The one button at the end. */
	action?: ReactNode;
	onPress?: () => void;
	onPressIn?: () => void;
	/** A long press. A screen reader offers it as an action named `longPressLabel`. */
	onLongPress?: () => void;
	longPressLabel?: string;
	accessibilityHint?: string;
}) {
	const longPress = onLongPress && longPressLabel ? onLongPress : undefined;
	return (
		<View className="min-h-14 flex-row items-center gap-3">
			<Pressable
				onPress={onPress}
				onPressIn={onPressIn}
				onLongPress={longPress}
				accessibilityRole={onPress ? "button" : undefined}
				accessibilityLabel={lineLabel({ at, title, caption })}
				accessibilityHint={accessibilityHint}
				accessibilityActions={
					longPress && longPressLabel
						? [{ name: "hold", label: longPressLabel }]
						: undefined
				}
				onAccessibilityAction={(event: AccessibilityActionEvent) => {
					if (event.nativeEvent.actionName === "hold") longPress?.();
				}}
				className={cn(
					"min-h-14 flex-1 flex-row items-center gap-3 py-2 active:opacity-70",
					muted && "opacity-50",
				)}
			>
				<Text
					numberOfLines={1}
					adjustsFontSizeToFit
					className={cn(
						"w-18 font-semibold tabular-nums",
						rail === "running" && "text-status-running",
					)}
				>
					{at === null ? "—" : formatTime(at)}
				</Text>
				<View className={cn("w-0.5 self-stretch rounded-full", RAIL[rail])} />
				<View className="flex-1 gap-0.5">
					<Text className="font-medium text-base" numberOfLines={1}>
						{title}
					</Text>
					<Text
						className={cn(
							"text-sm",
							rail === "offline" ? "text-destructive" : "text-muted-foreground",
						)}
						numberOfLines={1}
					>
						{caption}
					</Text>
				</View>
			</Pressable>
			{action}
		</View>
	);
}
