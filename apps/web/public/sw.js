/**
 * The service worker of Night Shift: it shows the notifications Night Shift
 * pushes to this browser while no Night Shift page is open (Web Push).
 *
 * A push carries no content: what happened, its ids and one short sentence
 * (`@nightshift/notifications`, `channels/web-push.ts`, `WebPushPayload`):
 *   { type: "show", kind, key, spaceId, runId, stepId, title, count }
 * Every push shows a notification: the subscription is `userVisibleOnly`,
 * and a push that shows nothing costs the site its subscription (Safari)
 * or a notice of the browser's own (Chrome). So no push takes one back: the
 * next open Night Shift page closes the notifications of the Gates that no
 * longer wait (`features/notifications`, `closeAnsweredGates`).
 * The notification's tag is the key, so a second push of one key replaces
 * the first. Its data has the kind and when it showed, for that page. A
 * click opens the Gate or the run in an open Night Shift tab, or in a new one.
 *
 * Vite copies `public/` into the build as it is: this file is plain
 * JavaScript, served at `/sw.js`, with the whole app as its scope.
 */

self.addEventListener("install", () => {
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

/** Where a click on the notification goes in the app. */
function pathOf(push) {
	if (push.kind === "gate-opened" && push.stepId) {
		return `/inbox?gate=${encodeURIComponent(push.stepId)}`;
	}
	if (
		(push.kind === "run-finished" || push.kind === "run-failed") &&
		push.runId
	) {
		return `/runs/${encodeURIComponent(push.runId)}`;
	}
	return "/inbox";
}

self.addEventListener("push", (event) => {
	let push = null;
	try {
		push = event.data ? event.data.json() : null;
	} catch {
		push = null;
	}
	if (!push || typeof push.key !== "string") return;
	if (push.type !== "show") return;
	event.waitUntil(
		self.registration.showNotification(push.title || "Night Shift", {
			tag: push.key,
			icon: "/favicon.svg",
			badge: "/favicon.svg",
			data: { path: pathOf(push), kind: push.kind, shownAt: Date.now() },
		}),
	);
});

/** Opens the path in a Night Shift tab: an open one gets focus, else a new one. */
async function open(path) {
	const url = new URL(path, self.location.origin).href;
	const windows = await self.clients.matchAll({
		type: "window",
		includeUncontrolled: true,
	});
	const tab =
		windows.find((client) => client.focused) ??
		windows.find((client) => client.visibilityState === "visible") ??
		windows[0];
	if (tab) {
		await tab.focus();
		// The app routes in the page itself: no reload.
		tab.postMessage({ type: "nightshift:open", path });
		return;
	}
	await self.clients.openWindow(url);
}

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const path = event.notification.data?.path || "/inbox";
	event.waitUntil(open(path));
});
