import { Stack } from "expo-router";

import type { HeaderToolbarProps } from "./header-items";

/**
 * The actions of a screen in its native header, through `Stack.Toolbar`.
 * Render it anywhere in the screen. On iOS a button is a system bar
 * button and a menu a system menu, with a check on the chosen option. A
 * view goes without the glass pill of iOS 26: it draws its own shape (the
 * avatar is a circle).
 * Android has its own file (`header-toolbar.android.tsx`).
 */
export function HeaderToolbar({ placement, items }: HeaderToolbarProps) {
	return (
		<Stack.Toolbar placement={placement}>
			{items.map((item) => {
				if (item.kind === "button") {
					return (
						<Stack.Toolbar.Button
							key={item.key}
							icon={item.sf}
							accessibilityLabel={item.label}
							accessibilityHint={item.hint}
							onPress={item.onPress}
						/>
					);
				}
				if (item.kind === "menu") {
					return (
						<Stack.Toolbar.Menu
							key={item.key}
							icon={item.sf}
							title={item.title}
							accessibilityLabel={item.label}
							accessibilityHint={item.hint}
							disabled={item.disabled}
						>
							{item.options.map((option) => (
								<Stack.Toolbar.MenuAction
									key={option.value}
									isOn={option.value === item.value}
									onPress={() => item.onChange(option.value)}
								>
									{option.label}
								</Stack.Toolbar.MenuAction>
							))}
						</Stack.Toolbar.Menu>
					);
				}
				return (
					<Stack.Toolbar.View key={item.key} hidesSharedBackground>
						{item.element}
					</Stack.Toolbar.View>
				);
			})}
		</Stack.Toolbar>
	);
}
