import { THEME } from "@nightshift/ui-native/lib/theme";
import {
	DarkTheme,
	DefaultTheme,
	type Theme,
} from "expo-router/react-navigation";

/**
 * Headers and sheets in the theme's colors. A header takes the page's
 * `background`, not `card`, so it reads as one surface with the screen,
 * as the desktop app's header does.
 */
export const NAV_THEME: Record<"light" | "dark", Theme> = {
	light: {
		...DefaultTheme,
		colors: {
			background: THEME.light.background,
			border: THEME.light.border,
			card: THEME.light.background,
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
			card: THEME.dark.background,
			notification: THEME.dark.destructive,
			primary: THEME.dark.primary,
			text: THEME.dark.foreground,
		},
	},
};
