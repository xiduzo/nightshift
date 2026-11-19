/** The kinds of push target, one channel each. */
export const PUSH_KINDS = ["web", "expo", "desktop"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/** A screen that gets pushes, as a channel needs it. */
export type PushTarget = {
	id: string;
	personId: string;
	kind: PushKind;
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
