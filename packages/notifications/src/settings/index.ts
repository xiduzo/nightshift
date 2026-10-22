/** A Person's notification settings: which events, quiet hours, which screens, the phone delay. */

export {
	type ComputerSwitches,
	createSettingsStore,
	eventsOfSwitches,
	inQuietHours,
	type NotificationSettings,
	type NotificationSettingsPatch,
	notificationSettingsPatchSchema,
	notificationSettingsSchema,
	type SettingsStore,
} from "./settings";
