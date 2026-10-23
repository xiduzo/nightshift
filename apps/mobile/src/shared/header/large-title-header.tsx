import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import type { ReactNode } from "react";
import { View } from "react-native";

export type LargeTitleHeaderProps = {
	title: string;
	/** One muted line under the title: "3 Gates need you · 2 Spaces". */
	summary?: string;
	/** On the left of the top row: the avatar on Home. */
	leading?: ReactNode;
	/** On the right of the top row: HeaderButtons, a Space picker. */
	actions?: ReactNode;
	/** A smaller title, for a sheet. */
	compact?: boolean;
};

/**
 * The top of a tab or a sheet: a row of header buttons, a large bold
 * title and a muted summary line. The first child of the Screen.
 */
export function LargeTitleHeader({
	title,
	summary,
	leading,
	actions,
	compact,
}: LargeTitleHeaderProps) {
	return (
		<View className="gap-1">
			{leading || actions ? (
				<View className="min-h-11 flex-row items-center justify-between gap-2">
					<View className="flex-row items-center gap-2">{leading}</View>
					<View className="flex-shrink flex-row items-center gap-2">
						{actions}
					</View>
				</View>
			) : null}
			<Text
				accessibilityRole="header"
				className={cn(
					"font-bold tracking-tight",
					compact ? "text-2xl" : "text-3xl",
				)}
			>
				{title}
			</Text>
			{summary ? (
				<Text className="text-muted-foreground text-sm">{summary}</Text>
			) : null}
		</View>
	);
}
