import { Button } from "@nightshift/ui-native/components/ui/button";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import { View } from "react-native";

export type ActionBarProps = {
	/** A small muted line above the label: "Your answer". */
	caption?: string;
	/** What the button acts on: "Approve". */
	label: string;
	/** A label in the destructive color: a choice that ends the run. */
	destructive?: boolean;
	/** The button: verb and object. */
	action: {
		label: string;
		onPress: () => void;
		disabled?: boolean;
		/** The button's label while it works: "Sending…". */
		busyLabel?: string;
		busy?: boolean;
		variant?: "default" | "destructive";
	};
};

/**
 * The bar at the bottom of a screen: what the person chose, and the one
 * button that acts on it. Give it to the Screen as its `footer`, so it
 * stays in place while the screen scrolls.
 */
export function ActionBar({
	caption,
	label,
	destructive,
	action,
}: ActionBarProps) {
	return (
		<View className="flex-row items-center gap-3 rounded-2xl border border-border bg-card py-2 pr-2 pl-4 shadow-black/5 shadow-sm">
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
						destructive && "text-destructive",
					)}
					numberOfLines={2}
				>
					{label}
				</Text>
			</View>
			<Button
				size="lg"
				variant={action.variant ?? "default"}
				disabled={action.disabled || action.busy}
				onPress={action.onPress}
				className="min-w-24"
			>
				<Text>
					{action.busy && action.busyLabel ? action.busyLabel : action.label}
				</Text>
			</Button>
		</View>
	);
}
