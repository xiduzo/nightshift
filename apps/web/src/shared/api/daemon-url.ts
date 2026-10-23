/**
 * The address of the Night Shift this UI calls. A page that Night Shift
 * served itself (a Host, the `nightshift` binary) says so in a meta tag,
 * and calls the address it came from: a Host has several addresses, and
 * the one the browser used is the one that answers. The desktop window
 * names the daemon it started (`window.nightshiftDaemonUrl`). Else the
 * address the UI was built for (VITE_SERVER_URL): the dev server.
 */
export function serverUrlFor(
	built: string,
	page: {
		origin: string;
		servedByDaemon: boolean;
		desktopDaemonUrl?: string;
	} | null,
): string {
	if (page?.servedByDaemon) return page.origin;
	return (page?.desktopDaemonUrl ?? built).replace(/\/$/, "");
}
