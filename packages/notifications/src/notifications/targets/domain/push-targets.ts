import { z } from "zod";

/**
 * The push targets of each Person: the browsers (Web Push), phones (Expo
 * Push) and desktop apps that get notifications while no Night Shift page
 * is open. A phone is one push target plus its session.
 */

/**
 * The kinds of push target, one channel each. The channels name the same
 * three (`PUSH_KINDS` of `channels`): the contract test of the store
 * compares them.
 */
export const TARGET_KINDS = ["web", "expo", "desktop"] as const;

/** The kinds of push target, as a request names them. */
export const pushKindSchema = z.enum(TARGET_KINDS);

/** A screen that gets pushes: the shape the channels send to (`PushTarget` of `channels`). */
export type PushTarget = {
	id: string;
	personId: string;
	kind: (typeof TARGET_KINDS)[number];
	name: string;
	platform: string;
	/** The Web Push endpoint URL, the Expo push token, or the desktop app's Device id. */
	endpoint: string;
	/** The Web Push subscription keys (`p256dh`, `auth`). Null for the other kinds. */
	keys: Record<string, string> | null;
	/** The session that registered it, or null. */
	sessionId: string | null;
	createdAt: number;
	lastSeenAt: number | null;
};

/** A push target to add, or to give new fields when its Person has its endpoint already. */
export type NewTarget = Omit<PushTarget, "createdAt" | "lastSeenAt"> & {
	/** When it registers: its first time, and the time it was seen. */
	at: number;
};

/** A push target as its Person sees it in Settings: no endpoint, no keys. */
export type PushTargetView = {
	id: string;
	kind: PushTarget["kind"];
	name: string;
	platform: string;
	createdAt: number;
	lastSeenAt: number | null;
};

const targetFields = {
	name: z.string().trim().min(1).max(120),
	platform: z.string().trim().max(60).default(""),
	endpoint: z.string().trim().min(1).max(2048),
	keys: z.record(z.string(), z.string().max(512)).nullable().default(null),
};

/** A push target as this daemon registers it, the desktop one included. */
export const registerTargetSchema = z.object({
	kind: pushKindSchema,
	...targetFields,
});
export type RegisterTarget = z.input<typeof registerTargetSchema>;

/**
 * The push services a browser subscribes with: Chrome and the browsers
 * built on it (FCM), Firefox (Mozilla), Safari (Apple) and Edge (Windows).
 * A Web Push endpoint is a URL the Host posts to, so it must be one of
 * these: any other address would let a Person make the Host call into its
 * own network.
 */
const WEB_PUSH_HOSTS = [
	"fcm.googleapis.com",
	"android.googleapis.com",
	"push.services.mozilla.com",
	"push.apple.com",
	"notify.windows.com",
];

/** Whether the Host may post a Web Push to this endpoint: `https:` on a known push service. */
function isWebPushEndpoint(endpoint: string): boolean {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return false;
	}
	if (url.protocol !== "https:" || url.port !== "") return false;
	if (url.username !== "" || url.password !== "") return false;
	const host = url.hostname.toLowerCase();
	return WEB_PUSH_HOSTS.some(
		(known) => host === known || host.endsWith(`.${known}`),
	);
}

/**
 * Whether the token is an Expo push token. The same test as
 * `Expo.isExpoPushToken` of `expo-server-sdk` 8: the contract test of the
 * store compares the two.
 */
export function isExpoPushToken(token: unknown): boolean {
	return (
		typeof token === "string" &&
		(((token.startsWith("ExponentPushToken[") ||
			token.startsWith("ExpoPushToken[")) &&
			token.endsWith("]")) ||
			/^[a-z\d]{8}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{12}$/i.test(token))
	);
}

/**
 * What a screen sends to register itself: a browser (Web Push) or a phone
 * (Expo Push). The desktop target is this computer's own: only its daemon
 * registers it, for the computer's owner.
 */
export const registerScreenSchema = z
	.object({ kind: z.enum(["web", "expo"]), ...targetFields })
	.superRefine((screen, ctx) => {
		if (screen.kind === "web" && !isWebPushEndpoint(screen.endpoint)) {
			ctx.addIssue({
				code: "custom",
				path: ["endpoint"],
				message: "This browser's push service is not one Night Shift knows.",
			});
		}
		if (screen.kind === "expo" && !isExpoPushToken(screen.endpoint)) {
			ctx.addIssue({
				code: "custom",
				path: ["endpoint"],
				message: "This phone's push token is not valid.",
			});
		}
	});

/** The sessions of the Person's phones: a phone is a push target plus its session. */
export function phoneSessionsOf(targets: readonly PushTarget[]): string[] {
	return targets.flatMap((target) =>
		target.kind === "expo" && target.sessionId ? [target.sessionId] : [],
	);
}

/**
 * The phones whose session ended (signed out, expired, revoked): such a
 * phone may hold another Person's session by now, so it gets nothing more.
 */
export function endedPhones(
	targets: readonly PushTarget[],
	live: ReadonlySet<string>,
): PushTarget[] {
	return targets.filter(
		(target) =>
			target.kind === "expo" &&
			target.sessionId !== null &&
			!live.has(target.sessionId),
	);
}

/** A push target as its Person sees it. */
export function targetView(target: PushTarget): PushTargetView {
	return {
		id: target.id,
		kind: target.kind,
		name: target.name,
		platform: target.platform,
		createdAt: target.createdAt,
		lastSeenAt: target.lastSeenAt,
	};
}
