/** A Person's notification settings: which events, quiet hours, which screens, the phone delay, the digest. */

export {
	type ComputerSwitches,
	createSettingsStore,
	digestDay,
	digestTime,
	eventsOfSwitches,
	inQuietHours,
	type NotificationSettings,
	type NotificationSettingsPatch,
	notificationSettingsPatchSchema,
	notificationSettingsSchema,
	type SettingsStore,
} from "./settings";
