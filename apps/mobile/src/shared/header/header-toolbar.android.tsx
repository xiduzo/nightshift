import { Stack } from "expo-router";
import { View } from "react-native";

import { HeaderButton } from "./header-button";
import type { HeaderToolbarProps } from "./header-items";

/**
 * The actions of a screen in its native header on Android: React Native
 * Reusables buttons in a row (`asChild`). The native toolbar items of
 * Android need drawables for their icons, which this app does not ship.
 */
export function HeaderToolbar({ placement, items }: HeaderToolbarProps) {
	return (
		<Stack.Toolbar placement={placement} asChild>
			<View className="flex-row items-center gap-2">
				{items.map((item) =>
					item.kind === "button" ? (
						<HeaderButton
							key={item.key}
							icon={item.icon}
							label={item.label}
							hint={item.hint}
							onPress={item.onPress}
						/>
					) : (
						<View key={item.key}>{item.element}</View>
					),
				)}
			</View>
		</Stack.Toolbar>
	);
}
