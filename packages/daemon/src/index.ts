/**
 * The Night Shift daemon: one runtime for `bun run dev`, `nightshift serve`
 * and the desktop app. `startDaemon` is the one boot sequence. The CLI and
 * the desktop app use the helpers around it.
 */

export type {
	DesktopNotice,
	DesktopNotifier,
	DesktopWindow,
	DesktopWindowState,
} from "@nightshift/notifications";
export {
	createDaemon,
	type Daemon,
	type DaemonInfo,
	type DaemonOptions,
} from "./daemon";
export {
	directoryWeb,
	embeddedWeb,
	tlsPortOf,
	type WebFiles,
	webHandler,
} from "./http";
export type { DesktopScreen } from "./notifications";
export {
	checkHealth,
	type DaemonEnv,
	DEFAULT_PORT,
	DESKTOP_PORT,
	daemonPort,
	guardProcess,
	HEALTH_STALE_AFTER_MS,
	type HealthCheck,
	prepareDaemonEnv,
} from "./runtime";
export { type RunningDaemon, type StartOptions, startDaemon } from "./start";
