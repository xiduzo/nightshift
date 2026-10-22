/**
 * The theme colors as JavaScript reads them: for the navigation theme
 * (headers, the tab bar) and for any prop that takes a color, not a class.
 *
 * The same tokens as `styles/global.css`, in hex: React Native has no
 * oklch(), and only the CSS goes through Uniwind, which converts it.
 * Change a value there and here together. The `status*` colors are the
 * run status tokens (`--color-status-*`): a widget or a lock-screen
 * notification renders outside the app and takes them as props.
 */
export const THEME = {
	light: {
		background: "#ffffff",
		foreground: "#0a0a0a",
		card: "#ffffff",
		cardForeground: "#0a0a0a",
		popover: "#ffffff",
		popoverForeground: "#0a0a0a",
		primary: "#171717",
		primaryForeground: "#fafafa",
		secondary: "#f5f5f5",
		secondaryForeground: "#171717",
		muted: "#f5f5f5",
		mutedForeground: "#737373",
		accent: "#f5f5f5",
		accentForeground: "#171717",
		destructive: "#df2225",
		border: "#e5e5e5",
		input: "#e5e5e5",
		ring: "#a1a1a1",
		statusRunning: "#0064b9",
		statusFinished: "#007840",
		statusStopped: "#555555",
		statusFailed: "#c51e21",
		statusInterrupted: "#b64e10",
		statusWaiting: "#975800",
		statusSleeping: "#61529f",
		radius: 10,
	},
	dark: {
		background: "#0a0a0a",
		foreground: "#fafafa",
		card: "#171717",
		cardForeground: "#fafafa",
		popover: "#171717",
		popoverForeground: "#fafafa",
		primary: "#e5e5e5",
		primaryForeground: "#171717",
		secondary: "#262626",
		secondaryForeground: "#fafafa",
		muted: "#262626",
		mutedForeground: "#a1a1a1",
		accent: "#404040",
		accentForeground: "#fafafa",
		destructive: "#ff6467",
		border: "#ffffff1a",
		input: "#ffffff26",
		ring: "#737373",
		statusRunning: "#5db2f7",
		statusFinished: "#56d089",
		statusStopped: "#ababab",
		statusFailed: "#fe6c66",
		statusInterrupted: "#fc9252",
		statusWaiting: "#f7bc50",
		statusSleeping: "#b0a8e7",
		radius: 10,
	},
} as const;

export type ThemeName = keyof typeof THEME;
