import { Stack } from "expo-router";
import { View } from "react-native";

import { HeaderButton } from "./header-button";
import type { HeaderToolbarProps } from "./header-items";
import { HeaderMenu } from "./header-menu";

/**
 * The actions of a screen in its native header on Android: React Native
 * Reusables buttons in a row (`asChild`), and a menu as a Material
 * dropdown menu. The native toolbar items of Android need drawables for
 * their icons, which this app does not ship.
 */
export function HeaderToolbar({ placement, items }: HeaderToolbarProps) {
	return (
		<Stack.Toolbar placement={placement} asChild>
			{/* Room between the avatar on the left and the title. */}
			<View
				className={`flex-row items-center gap-2 ${placement === "left" ? "mr-4" : ""}`}
			>
				{items.map((item) => {
					if (item.kind === "button") {
						return (
							<HeaderButton
								key={item.key}
								icon={item.icon}
								label={item.label}
								hint={item.hint}
								onPress={item.onPress}
							/>
						);
					}
					if (item.kind === "menu") {
						return <HeaderMenu key={item.key} item={item} />;
					}
					return <View key={item.key}>{item.element}</View>;
				})}
			</View>
		</Stack.Toolbar>
	);
}
