import { HOUR_MS, type MoonPhase, moonPhase } from "@nightshift/time";

/**
 * The menu bar and Dock icons follow the phase of the moon, like the logo
 * in the app. `bun run icons` draws one image per phase into `assets/moon`,
 * and the build copies them to `views://moon/`.
 */
export type MoonIcons = {
	/** Shows the menu bar icon at this path (`views://…`). */
	tray: (image: string) => void;
	/** Shows the Dock icon at this file path. */
	dock: (path: string) => void;
	/** The folder `views://` points to. */
	viewsFolder: string;
};

/** The menu bar image of a phase, for `Tray.setImage`. */
export const trayImage = (phase: MoonPhase) => `views://moon/tray-${phase}.png`;

/** Shows the moon of now, and again each hour when the phase has changed. */
export function followMoon(
	icons: MoonIcons,
	at = () => moonPhase(),
): () => void {
	let shown: MoonPhase | undefined;
	const show = () => {
		const phase = at();
		if (phase === shown) return;
		shown = phase;
		icons.tray(trayImage(phase));
		try {
			icons.dock(`${icons.viewsFolder}/moon/dock-${phase}.png`);
		} catch (error) {
			// The Dock keeps the icon of the bundle.
			console.warn("The Dock icon did not change:", error);
		}
	};
	show();
	const timer = setInterval(show, HOUR_MS);
	return () => clearInterval(timer);
}
