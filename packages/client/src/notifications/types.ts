import type { ApiInputs, ApiOutputs } from "../api";

/**
 * One item of `notifications.watch`: a Gate opened or closed, or a run
 * finished or failed, in any Space the person is in. Ids and one short
 * sentence, no content.
 */
export type NotificationItem =
	ApiOutputs["notifications"]["watch"] extends AsyncIterable<infer Item>
		? Item
		: never;

/** The person's notification settings: which events, quiet hours, which screens, the phone delay. */
export type NotificationSettings =
	ApiOutputs["notifications"]["settings"]["get"];

/** A change of the notification settings: only the fields given change. */
export type NotificationSettingsPatch =
	ApiInputs["notifications"]["settings"]["save"];

/** A browser, phone or desktop app that gets the person's notifications. */
export type NotificationScreen =
	ApiOutputs["notifications"]["targets"]["list"][number];

/** What a screen sends to get notifications. */
export type RegisterScreenInput =
	ApiInputs["notifications"]["targets"]["register"];
