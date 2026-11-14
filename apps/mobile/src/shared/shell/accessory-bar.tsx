import { Button } from "@nightshift/ui-native/components/ui/button";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { router } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { Pressable, View } from "react-native";

import type { AccessoryBarProps } from "./tabs";

/** A tap on what waits opens Needs you. */
function openNeeds() {
	router.navigate("/");
}

/**
 * The bar above the tabs on iOS 26: the tab bar accessory (the slot of
 * the mini player in Music), drawn in Liquid Glass by the system. What
 * waits, the option you chose in its flow color, and Send. While you
 * scroll iOS makes it small next to the tabs: then it shows only the
 * count. Android has its own file (`accessory-bar.android.tsx`).
 */
export function AccessoryBar({
	caption,
	label,
	color,
	short,
	action,
}: AccessoryBarProps) {
	const placement = NativeTabs.BottomAccessory.usePlacement();

	if (placement === "inline" || caption === null) {
		return (
			<Pressable
				className="flex-1 justify-center px-4"
				onPress={openNeeds}
				accessibilityRole="button"
				accessibilityHint="Opens Needs you"
			>
				<Text className="font-semibold text-sm" numberOfLines={1}>
					{short}
				</Text>
			</Pressable>
		);
	}

	return (
		<View className="flex-1 flex-row items-center gap-3 pr-1.5 pl-4">
			<Pressable
				className="flex-1"
				onPress={openNeeds}
				accessibilityRole="button"
				accessibilityLabel={`${caption}, ${label}`}
				accessibilityHint="Opens Needs you"
			>
				<Text className="text-muted-foreground text-xs" numberOfLines={1}>
					{caption}
				</Text>
				<Text
					className="font-semibold text-sm"
					style={color ? { color } : undefined}
					numberOfLines={1}
				>
					{label}
				</Text>
			</Pressable>
			{action ? (
				<Button
					size="sm"
					disabled={action.disabled}
					className="rounded-full"
					// A color fills the button: its text stays primary-foreground.
					style={color ? { backgroundColor: color } : undefined}
					onPress={action.onPress}
				>
					<Text>{action.label}</Text>
				</Button>
			) : null}
		</View>
	);
}
