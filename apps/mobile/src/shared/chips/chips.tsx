import { Button } from "@nightshift/ui-native/components/ui/button";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { ScrollView } from "react-native";

/**
 * Filter chips in a row that scrolls sideways, edge to edge of the
 * screen. Put Chips in it.
 */
export function ChipRail({ children }: { children: ReactNode }) {
	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			className="-mx-4 grow-0"
			contentContainerClassName="gap-2 px-4"
			accessibilityRole="tablist"
		>
			{children}
		</ScrollView>
	);
}

/**
 * One filter of a ChipRail: a rounded Button, `default` when it is
 * chosen and `outline` when not, with an optional count. 44 pt high.
 */
export function Chip({
	label,
	count,
	selected = false,
	icon,
	onPress,
	accessibilityHint,
}: {
	label: string;
	/** How many items the filter shows. */
	count?: number;
	selected?: boolean;
	icon?: LucideIcon;
	onPress: () => void;
	/** What a tap does, when the label does not say it: "Shows the runs of every project". */
	accessibilityHint?: string;
}) {
	return (
		<Button
			variant={selected ? "default" : "outline"}
			className="h-11 rounded-full px-4"
			onPress={onPress}
			accessibilityRole="tab"
			accessibilityState={{ selected }}
			accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
			accessibilityHint={accessibilityHint}
		>
			{icon ? <Icon as={icon} /> : null}
			<Text>{label}</Text>
			{count !== undefined ? (
				<Text className="tabular-nums opacity-70">{count}</Text>
			) : null}
		</Button>
	);
}
