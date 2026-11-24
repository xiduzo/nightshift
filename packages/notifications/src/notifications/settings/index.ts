/** A Person's notification settings: which events, quiet hours, which screens, and the phone delay. `wireSettings` binds the use cases to their ports. */

export {
	inQuietHours,
	type NotificationSettings,
	type NotificationSettingsPatch,
	notificationSettingsPatchSchema,
	notificationSettingsSchema,
	pushesUrgency,
} from "./domain/notification-settings";
export { wireSettings } from "./wire";
