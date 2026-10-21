import { THEME } from "@nightshift/ui-native/lib/theme";
import {
	DarkTheme,
	DefaultTheme,
	type Theme,
} from "expo-router/react-navigation";

/** Headers and the tab bar in the theme's colors. */
export const NAV_THEME: Record<"light" | "dark", Theme> = {
	light: {
		...DefaultTheme,
		colors: {
			background: THEME.light.background,
			border: THEME.light.border,
			card: THEME.light.card,
			notification: THEME.light.destructive,
			primary: THEME.light.primary,
			text: THEME.light.foreground,
		},
	},
	dark: {
		...DarkTheme,
		colors: {
			background: THEME.dark.background,
			border: THEME.dark.border,
			card: THEME.dark.card,
			notification: THEME.dark.destructive,
			primary: THEME.dark.primary,
			text: THEME.dark.foreground,
		},
	},
};
