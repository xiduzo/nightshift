import type { OutcomeColor } from "@nightshift/flows";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Card } from "@nightshift/ui-native/components/ui/card";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import { View } from "react-native";

import { OUTCOME_CLASS } from "@/shared/tone";

export type ActionBarProps = {
	/** A small muted line above the label: "Your answer". */
	caption?: string;
	/** What the button acts on: "Approve". */
	label: string;
	/** A label in the destructive color: a choice that ends the run. */
	destructive?: boolean;
	/**
	 * The flow color of what the person chose: the label shows in it, and
	 * the button fills with it. It goes before `destructive` and the
	 * button's variant.
	 */
	color?: OutcomeColor;
	/** The button: verb and object. */
	action: {
		label: string;
		onPress: () => void;
		disabled?: boolean;
		/** The button's label while it works: "Sending…". */
		busyLabel?: string;
		busy?: boolean;
		variant?: "default" | "destructive";
		/** What happens on a tap, for the screen reader. */
		hint?: string;
	};
};

/**
 * The bar at the bottom of a screen, on a Card: what the person chose,
 * and the one button that acts on it, in the color of the choice. Give it
 * to the Screen as its `footer`, so it stays in place while the screen
 * scrolls.
 */
export function ActionBar({
	caption,
	label,
	destructive,
	color,
	action,
}: ActionBarProps) {
	const tint = color ? OUTCOME_CLASS[color] : null;
	return (
		<Card className="flex-row items-center gap-3 py-2 pr-2 pl-4">
			<View
				className="flex-1 gap-0.5"
				accessible
				accessibilityLabel={[caption, label].filter(Boolean).join(", ")}
			>
				{caption ? (
					<Text className="text-muted-foreground text-xs" numberOfLines={1}>
						{caption}
					</Text>
				) : null}
				<Text
					className={cn(
						"font-semibold text-base",
						tint ? tint.text : destructive && "text-destructive",
					)}
					numberOfLines={2}
				>
					{label}
				</Text>
			</View>
			<Button
				size="lg"
				// A color fills the default button: its text stays primary-foreground.
				variant={tint ? "default" : (action.variant ?? "default")}
				disabled={action.disabled || action.busy}
				onPress={action.onPress}
				accessibilityHint={action.hint}
				className={cn("h-auto min-h-11 min-w-24 py-2", tint?.button)}
			>
				<Text>
					{action.busy && action.busyLabel ? action.busyLabel : action.label}
				</Text>
			</Button>
		</Card>
	);
}
