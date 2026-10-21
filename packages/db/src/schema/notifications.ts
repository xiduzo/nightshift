import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { createdAt, updatedAt } from "./columns";

// Owner: `@nightshift/notifications`: `settings/` (a Person's notification
// settings), `targets/` (the browsers, phones and desktop apps that get
// notifications while no Night Shift page is open), `deliveries/` (what
// the notifier sent, held and withdrawn) and `channels/` (the VAPID keys of
// Web Push). No foreign keys to the auth
// tables: a Person's rows go with the Person through the owner's functions.

/**
 * A Person's notification settings: which events, quiet hours, which
 * screens, and how long a phone waits after an open screen. They belong to
 * the Person, not to a computer. No row: the defaults.
 */
export const notificationSettings = sqliteTable("notification_settings", {
	personId: text("person_id").primaryKey(),
	/** A Gate waits for the Person. */
	gateOpened: integer("gate_opened", { mode: "boolean" })
		.notNull()
		.default(true),
	runFinished: integer("run_finished", { mode: "boolean" })
		.notNull()
		.default(true),
	runFailed: integer("run_failed", { mode: "boolean" }).notNull().default(true),
	/** Quiet hours start, `HH:MM` in `time_zone`. Null: no quiet hours. */
	quietStart: text("quiet_start"),
	/** Quiet hours end, `HH:MM` in `time_zone`. */
	quietEnd: text("quiet_end"),
	/** An IANA time zone, for example `Europe/Amsterdam`. */
	timeZone: text("time_zone").notNull().default("UTC"),
	/** JSON: which kinds of screen get pushes, `{ "web": true, "expo": true, "desktop": true }`. */
	screens: text("screens").notNull().default("{}"),
	/** How long a push to a phone or a closed browser waits while a screen is open. */
	holdMinutes: integer("hold_minutes").notNull().default(3),
	updatedAt: updatedAt(),
});

/**
 * A screen that gets notifications while no Night Shift page is open: a
 * browser (Web Push), a phone (Expo Push) or a desktop app. One Person has
 * many. The same endpoint registers once per Person.
 */
export const pushTarget = sqliteTable(
	"push_target",
	{
		id: text("id").primaryKey(),
		personId: text("person_id").notNull(),
		/** `web`, `expo` or `desktop`. */
		kind: text("kind").notNull(),
		/** What the Person calls it: "Safari on MacBook", "Pixel 9". */
		name: text("name").notNull(),
		/** The platform it reports: `ios`, `android`, `darwin`, a browser. */
		platform: text("platform").notNull().default(""),
		/** The Web Push endpoint URL, the Expo push token, or the desktop app's Device id. */
		endpoint: text("endpoint").notNull(),
		/** JSON: the Web Push subscription keys (`p256dh`, `auth`). Null for the other kinds. */
		keys: text("keys"),
		/** The Better Auth session that registered it: removing a phone ends it. */
		sessionId: text("session_id"),
		createdAt: createdAt(),
		lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
	},
	(table) => [
		index("push_target_personId_idx").on(table.personId),
		uniqueIndex("push_target_personId_endpoint_idx").on(
			table.personId,
			table.endpoint,
		),
	],
);

/**
 * What the notifier did with one event for one Person: sent, held or
 * withdrawn. Keyed by the event (`runId:stepId` for a Gate,
 * `runId:end:<seq>` for a run that ended), so a notification goes out once
 * and can be withdrawn on every screen that got it.
 */
export const notificationDelivery = sqliteTable(
	"notification_delivery",
	{
		personId: text("person_id").notNull(),
		key: text("key").notNull(),
		/** `gate-opened`, `run-finished` or `run-failed`. */
		kind: text("kind").notNull(),
		spaceId: text("space_id").notNull(),
		runId: text("run_id").notNull(),
		/** The Gate's step. Null for a run. */
		stepId: text("step_id"),
		/**
		 * `held`: waits until `due_at` while a screen is open. `quiet`: waits
		 * for the end of quiet hours. `sent`, `dropped` or `withdrawn`.
		 */
		status: text("status").notNull(),
		/** When a held notification goes out, epoch ms. */
		dueAt: integer("due_at", { mode: "timestamp_ms" }),
		/** JSON: the push targets that got it, by id: they get the withdraw. */
		sentTo: text("sent_to").notNull().default("[]"),
		/** JSON: the push targets that still wait for it, by id. */
		heldFor: text("held_for").notNull().default("[]"),
		createdAt: createdAt(),
		sentAt: integer("sent_at", { mode: "timestamp_ms" }),
		withdrawnAt: integer("withdrawn_at", { mode: "timestamp_ms" }),
	},
	(table) => [
		primaryKey({ columns: [table.personId, table.key] }),
		index("notification_delivery_key_idx").on(table.key),
		index("notification_delivery_status_idx").on(table.status),
	],
);

/**
 * The VAPID key pair this daemon signs its Web Push messages with. The
 * daemon makes it once, the first time a browser asks for the public key
 * or a push goes out. A browser subscribes with the public key, so the
 * pair must stay: a new pair loses every browser subscription. One row.
 */
export const webPushKey = sqliteTable("web_push_key", {
	/** Always `vapid`: one pair per daemon. */
	id: text("id").primaryKey(),
	/** The public key, URL-safe base64, as `PushManager.subscribe` takes it. */
	publicKey: text("public_key").notNull(),
	/** The private key, URL-safe base64. Never leaves this daemon. */
	privateKey: text("private_key").notNull(),
	createdAt: createdAt(),
});
