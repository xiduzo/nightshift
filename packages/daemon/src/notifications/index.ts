/** The notifier of this daemon, wired: its channels, its owner's screen and the old notification switches. Who hears of a stored synced document. */

export { documentAudience } from "./document-audience";
export {
	type DesktopScreen,
	sendsPushesFor,
	wireNotifications,
} from "./wire";
