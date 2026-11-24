/** The notifier of this daemon, wired: its channels and its owner's screen. Who hears of a stored synced document. */

export { documentAudience } from "./document-audience";
export {
	type DesktopScreen,
	sendsPushesFor,
	wireNotifications,
} from "./wire";
