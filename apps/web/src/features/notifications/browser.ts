/**
 * What this browser can do for notifications: show one, close the ones of
 * a key, and keep a Web Push subscription with the service worker
 * (`public/sw.js`). Every function is safe on the server and in a browser
 * without these features: it does nothing, or answers "unsupported".
 */

/** The service worker's path. Its scope is the whole app. */
const SERVICE_WORKER = "/sw.js";

/** Where this browser keeps the id of its own screen, to tell it apart in the list. */
const SCREEN_ID_KEY = "nightshift.notifications.screen";

/**
 * True in the window of the Night Shift desktop app (its preload sets
 * `window.nightshiftDesktop`). The app shows the notifications there.
 */
export function inDesktopApp(): boolean {
	return (
		typeof window !== "undefined" &&
		(window as { nightshiftDesktop?: unknown }).nightshiftDesktop === true
	);
}

/** True when this browser can show notifications. */
export function notificationsSupported(): boolean {
	return typeof window !== "undefined" && "Notification" in window;
}

/**
 * True when this browser can get notifications while no Night Shift page is
 * open: a service worker and Web Push, on a secure address.
 */
export function pushSupported(): boolean {
	return (
		notificationsSupported() &&
		window.isSecureContext &&
		"serviceWorker" in navigator &&
		"PushManager" in window
	);
}

/** What `homeScreenNeeded` reads of this browser. */
export type BrowserFacts = {
	userAgent: string;
	platform: string;
	maxTouchPoints: number;
	/** The page runs from the Home Screen, not in a browser tab. */
	standalone: boolean;
};

/**
 * True on an iPhone or iPad when Night Shift runs in a browser tab. iOS
 * gives notifications only to a site added to the Home Screen.
 */
export function homeScreenNeeded(facts: BrowserFacts): boolean {
	const iPhoneOrIPad =
		/iPhone|iPad|iPod/.test(facts.userAgent) ||
		// An iPad asks for the desktop site: it says it is a Mac with touch.
		(facts.platform === "MacIntel" && facts.maxTouchPoints > 1);
	return iPhoneOrIPad && !facts.standalone;
}

/** `homeScreenNeeded` for this browser. False on the server. */
export function needsHomeScreen(): boolean {
	if (typeof window === "undefined" || typeof navigator === "undefined") {
		return false;
	}
	return homeScreenNeeded({
		userAgent: navigator.userAgent,
		platform: navigator.platform,
		maxTouchPoints: navigator.maxTouchPoints,
		standalone:
			window.matchMedia?.("(display-mode: standalone)").matches === true ||
			(navigator as { standalone?: boolean }).standalone === true,
	});
}

/** Registers the service worker once. Null when this browser has none. */
export async function serviceWorker(): Promise<ServiceWorkerRegistration | null> {
	if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
		return null;
	}
	if (!window.isSecureContext) return null;
	try {
		await navigator.serviceWorker.register(SERVICE_WORKER);
		return await navigator.serviceWorker.ready;
	} catch {
		return null;
	}
}

/**
 * Shows a notification with the key as its tag: a second one of the key
 * replaces the first, and `closeNotifications` finds it. Through the
 * service worker when it runs, so a click opens the path in this tab.
 */
export async function showNotification(options: {
	key: string;
	/** What happened: `gate-opened` lets `closeAnsweredGates` find it. */
	kind: string;
	title: string;
	body?: string;
	path: string;
	onClick: () => void;
}): Promise<void> {
	// The desktop app shows its own notifications: none twice.
	if (inDesktopApp()) return;
	if (!notificationsSupported() || Notification.permission !== "granted") {
		return;
	}
	const registration = await serviceWorker();
	if (registration) {
		await registration.showNotification(options.title, {
			tag: options.key,
			body: options.body,
			icon: "/favicon.svg",
			data: { path: options.path, kind: options.kind, shownAt: Date.now() },
		});
		return;
	}
	try {
		const notification = new Notification(options.title, {
			tag: options.key,
			body: options.body,
		});
		notification.onclick = () => {
			window.focus();
			options.onClick();
			notification.close();
		};
	} catch {
		// Some browsers allow notifications only from a service worker.
	}
}

/** Closes the notifications of the key on this computer. */
export async function closeNotifications(key: string): Promise<void> {
	if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
		return;
	}
	const registration = await navigator.serviceWorker.getRegistration();
	const shown = (await registration?.getNotifications({ tag: key })) ?? [];
	for (const notification of shown) notification.close();
}

/** What `answeredGates` reads of one shown notification. */
export type ShownNotification = { tag: string; data: unknown };

/**
 * The tags of the shown Gate notifications whose Gate no longer waits:
 * not in `openKeys`, and shown before the Gates were read (`readAt`). One
 * shown after that read may be a Gate the read did not know yet.
 */
export function answeredGates(
	shown: readonly ShownNotification[],
	openKeys: ReadonlySet<string>,
	readAt: number,
): string[] {
	const tags = new Set<string>();
	for (const notification of shown) {
		const data = notification.data as {
			kind?: unknown;
			shownAt?: unknown;
		} | null;
		if (data?.kind !== "gate-opened") continue;
		if (typeof data.shownAt !== "number" || data.shownAt >= readAt) continue;
		if (!openKeys.has(notification.tag)) tags.add(notification.tag);
	}
	return [...tags];
}

/**
 * Closes the Gate notifications of this browser whose Gate no longer
 * waits. No push takes a notification back (a push must show one), so an
 * open page does it each time it reads the open Gates.
 */
export async function closeAnsweredGates(
	openKeys: ReadonlySet<string>,
	readAt: number,
): Promise<void> {
	if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
		return;
	}
	try {
		const registration = await navigator.serviceWorker.getRegistration();
		const shown = (await registration?.getNotifications()) ?? [];
		const stale = new Set(answeredGates(shown, openKeys, readAt));
		for (const notification of shown) {
			if (stale.has(notification.tag)) notification.close();
		}
	} catch {
		// The next read of the open Gates tries again.
	}
}

/** Calls `open` with the path of each notification the person clicks. Returns the unsubscribe. */
export function onNotificationClick(open: (path: string) => void): () => void {
	if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
		return () => {};
	}
	const listener = (event: MessageEvent) => {
		const data = event.data as { type?: unknown; path?: unknown } | null;
		if (data?.type === "nightshift:open" && typeof data.path === "string") {
			open(data.path);
		}
	};
	navigator.serviceWorker.addEventListener("message", listener);
	return () => navigator.serviceWorker.removeEventListener("message", listener);
}

/** The bytes of a URL-safe base64 VAPID key, as `PushManager.subscribe` takes them. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
	const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
	const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
	const text = atob(padded);
	const bytes = new Uint8Array(new ArrayBuffer(text.length));
	for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
	return bytes;
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
	if (!a || a.byteLength !== b.byteLength) return false;
	const view = new Uint8Array(a);
	return view.every((byte, i) => byte === b[i]);
}

/** This browser's push subscription, or null. */
export async function currentSubscription(): Promise<PushSubscription | null> {
	if (!pushSupported()) return null;
	const registration = await navigator.serviceWorker.getRegistration();
	return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Subscribes this browser to Web Push with the public key. A subscription
 * for another key (another Night Shift) is replaced.
 */
export async function subscribe(publicKey: string): Promise<PushSubscription> {
	const registration = await serviceWorker();
	if (!registration) {
		throw new Error("This browser cannot get notifications from Night Shift.");
	}
	const key = keyBytes(publicKey);
	const existing = await registration.pushManager.getSubscription();
	if (existing && sameKey(existing.options.applicationServerKey, key)) {
		return existing;
	}
	await existing?.unsubscribe();
	return registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: key,
	});
}

/** What Night Shift needs of a subscription to push to it. */
export function subscriptionParts(subscription: PushSubscription): {
	endpoint: string;
	keys: Record<string, string>;
} {
	const json = subscription.toJSON();
	return { endpoint: subscription.endpoint, keys: { ...json.keys } };
}

/** A name the person recognizes in the list: "Firefox on macOS". */
export function browserName(): { name: string; platform: string } {
	if (typeof navigator === "undefined") {
		return { name: "Browser", platform: "" };
	}
	const agent = navigator.userAgent;
	const browser = /Edg\//.test(agent)
		? "Edge"
		: /OPR\//.test(agent)
			? "Opera"
			: /Firefox\//.test(agent)
				? "Firefox"
				: /Chrome\//.test(agent)
					? "Chrome"
					: /Safari\//.test(agent)
						? "Safari"
						: "Browser";
	const system = /iPhone|iPad/.test(agent)
		? "iOS"
		: /Android/.test(agent)
			? "Android"
			: /Mac OS X/.test(agent)
				? "macOS"
				: /Windows/.test(agent)
					? "Windows"
					: /Linux/.test(agent)
						? "Linux"
						: null;
	return {
		name: system ? `${browser} on ${system}` : browser,
		platform: browser.toLowerCase(),
	};
}

/** The id of this browser's own screen, when it registered one. */
export function ownScreenId(): string | null {
	try {
		return localStorage.getItem(SCREEN_ID_KEY);
	} catch {
		return null;
	}
}

/** Remembers (or forgets, with null) the id of this browser's own screen. */
export function setOwnScreenId(id: string | null): void {
	try {
		if (id) localStorage.setItem(SCREEN_ID_KEY, id);
		else localStorage.removeItem(SCREEN_ID_KEY);
	} catch {
		// Private windows may refuse storage: the list then marks no row.
	}
}

/** A reason Night Shift wrote for the person: it shows as it is. */
export class BrowserPushProblem extends Error {}

/**
 * What a toast says when this browser's notifications did not turn on or
 * off. A browser's own error is not for the person, so it gets fixed words.
 */
export function browserPushErrorText(
	error: unknown,
	turningOn: boolean,
): string {
	if (error instanceof BrowserPushProblem) return error.message;
	return turningOn
		? "Notifications in this browser did not turn on. Try again, or check the notification settings of this browser."
		: "Notifications in this browser did not turn off. Try again.";
}
