import { THEME, type ThemeName } from "@nightshift/ui-native/lib/theme";
import { useUniwind } from "uniwind";

/**
 * The light or dark theme, as the phone's setting chooses it, and its
 * colors for a prop that takes a color, not a class: the navigation
 * theme, the tab bar, a RefreshControl. Components style with classes;
 * only those props read these.
 */
export function useThemeColors(): {
	scheme: ThemeName;
	colors: (typeof THEME)[ThemeName];
} {
	const { theme } = useUniwind();
	const scheme: ThemeName = theme === "dark" ? "dark" : "light";
	return { scheme, colors: THEME[scheme] };
}
