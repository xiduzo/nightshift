import { Stack } from "expo-router";

import type { HeaderToolbarProps } from "./header-items";

/**
 * The actions of a screen in its native header, through `Stack.Toolbar`.
 * Render it anywhere in the screen. On iOS a button is a system bar
 * button. A view goes without the glass pill of iOS 26: it draws its own
 * shape (the Space picker is a bordered Select, the avatar a circle).
 * Android has its own file (`header-toolbar.android.tsx`).
 */
export function HeaderToolbar({ placement, items }: HeaderToolbarProps) {
	return (
		<Stack.Toolbar placement={placement}>
			{items.map((item) =>
				item.kind === "button" ? (
					<Stack.Toolbar.Button
						key={item.key}
						icon={item.sf}
						accessibilityLabel={item.label}
						accessibilityHint={item.hint}
						onPress={item.onPress}
					/>
				) : (
					<Stack.Toolbar.View key={item.key} hidesSharedBackground>
						{item.element}
					</Stack.Toolbar.View>
				),
			)}
		</Stack.Toolbar>
	);
}
