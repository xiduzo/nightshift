/** The form of a settings card: it reads the settings, saves each change, and has the fields the cards share. */

export {
	CardForm,
	HeadersCard,
	ResetSection,
	SaveErrorRow,
	SelectSetting,
	SwitchSetting,
	TextSetting,
} from "./setting-fields";
export {
	type SettingKey,
	type SettingsPatch,
	useSaveSettings,
	useSettingsForm,
	useToggleSetting,
} from "./use-settings-form";
