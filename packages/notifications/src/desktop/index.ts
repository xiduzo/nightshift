/** The desktop notification: the channel to this computer's own desktop, and its OS ports. */

export {
	createDesktopChannel,
	type DesktopNotice,
	type DesktopNotifier,
	type DesktopWindow,
	type DesktopWindowState,
} from "./desktop";
export { systemDesktopNotifier } from "./system";
