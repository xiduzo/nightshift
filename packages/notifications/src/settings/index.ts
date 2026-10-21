/** A Person's notification settings: which events, quiet hours, which screens, the phone delay. */

export {
	createSettingsStore,
	DEFAULT_HOLD_MINUTES,
	inQuietHours,
	type NotificationSettings,
	type NotificationSettingsPatch,
	notificationSettingsPatchSchema,
	notificationSettingsSchema,
	type SettingsStore,
} from "./settings";
