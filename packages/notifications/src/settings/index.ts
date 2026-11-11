/** A Person's notification settings: which events, quiet hours, which screens, and the phone delay. */

export {
	type ComputerSwitches,
	createSettingsStore,
	eventsOfSwitches,
	inQuietHours,
	type NotificationSettings,
	type NotificationSettingsPatch,
	notificationSettingsPatchSchema,
	notificationSettingsSchema,
	pushesUrgency,
	type SettingsStore,
} from "./settings";
