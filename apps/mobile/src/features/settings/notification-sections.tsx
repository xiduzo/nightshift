import {
	type NotificationSettings,
	type NotificationSettingsPatch,
	PHONE_DELAYS,
	phoneDelayLabel,
	URGENCY_LABEL,
} from "@nightshift/client";
import { GATE_URGENCIES } from "@nightshift/flows";
import { CircleAlert } from "lucide-react-native";

import {
	NativeButtonRow,
	NativeLoadingRow,
	NativePickerRow,
	NativeRow,
	NativeSection,
	NativeToggleRow,
} from "@/shared/native-list";
import {
	DEFAULT_PUSH_URGENCIES,
	HOURS,
	isLastPushUrgency,
	phoneTimeZone,
	pushUrgenciesWith,
} from "./notification-choices";
import {
	useNotificationSettings,
	useSaveNotificationSettings,
} from "./use-notification-settings";

/** Quiet hours when the person turns them on: the night. */
const DEFAULT_QUIET = { start: "22:00", end: "07:00" };

const HOUR_OPTIONS = HOURS.map((hour) => ({ value: hour, label: hour }));

const DELAY_OPTIONS = PHONE_DELAYS.map((minutes) => ({
	value: String(minutes),
	label: phoneDelayLabel(minutes),
}));

/**
 * The person's notification settings, as sections of the Settings list:
 * what Night Shift tells them about, which Gates send a notification, and
 * quiet hours. They apply on every screen. Each change saves at once.
 */
export function NotificationSections() {
	const settings = useNotificationSettings();
	const save = useSaveNotificationSettings();

	if (settings.data) {
		return (
			<>
				<TellMeSection value={settings.data} onChange={save} />
				<PushForSection value={settings.data} onChange={save} />
				<QuietSection value={settings.data} onChange={save} />
			</>
		);
	}
	if (settings.error) {
		return (
			<NativeSection
				title="Notifications"
				footer="Check that this phone is online, then try again."
			>
				<NativeRow
					icon={{ sf: "exclamationmark.circle.fill", lucide: CircleAlert }}
					iconColor="#dc2626"
					title="The notification settings did not load"
					subtitle={settings.error.message}
				/>
				<NativeButtonRow
					label="Try again"
					onPress={() => void settings.refetch()}
				/>
			</NativeSection>
		);
	}
	return (
		<NativeSection title="Notifications">
			<NativeLoadingRow label="Loading" />
		</NativeSection>
	);
}

type SectionProps = {
	value: NotificationSettings;
	onChange(patch: NotificationSettingsPatch): void;
};

/** Which events reach the person, and whether phones get them at all. */
function TellMeSection({ value, onChange }: SectionProps) {
	return (
		<>
			<NativeSection title="Tell me about">
				<NativeToggleRow
					title="Gates"
					subtitle="When a run waits for your answer"
					value={value.events.gateOpened}
					onChange={(on) => onChange({ events: { gateOpened: on } })}
				/>
				<NativeToggleRow
					title="Runs that stop"
					subtitle="When a run fails or stops early"
					value={value.events.runFailed}
					onChange={(on) => onChange({ events: { runFailed: on } })}
				/>
				<NativeToggleRow
					title="Runs that finish"
					subtitle="When a run is done"
					value={value.events.runFinished}
					onChange={(on) => onChange({ events: { runFinished: on } })}
				/>
				<NativeToggleRow
					title="Offline computers"
					subtitle="When a step waits for a computer that is offline"
					value={value.events.deviceWait}
					onChange={(on) => onChange({ events: { deviceWait: on } })}
				/>
			</NativeSection>
			<NativeSection footer="When off, your phones get no notifications. Needs you still shows what waits.">
				<NativeToggleRow
					title="Phones"
					value={value.screens.expo}
					onChange={(on) => onChange({ screens: { expo: on } })}
				/>
			</NativeSection>
		</>
	);
}

/**
 * Which Gates send a notification, by how soon they need you. The other
 * Gates still show in Needs you and count on the badge.
 */
function PushForSection({ value, onChange }: SectionProps) {
	const levels = value.pushUrgencies ?? DEFAULT_PUSH_URGENCIES;
	const off = !value.events.gateOpened;
	return (
		<NativeSection
			title="Push for"
			footer={
				off
					? "Turn on Gates above to choose."
					: "The Gates that send a notification. The others still show in Needs you."
			}
		>
			{GATE_URGENCIES.map((urgency) => (
				<NativeToggleRow
					key={urgency}
					title={URGENCY_LABEL[urgency]}
					value={levels.includes(urgency)}
					disabled={off || isLastPushUrgency(levels, urgency)}
					onChange={(on) =>
						onChange({
							pushUrgencies: pushUrgenciesWith(levels, urgency, on),
						})
					}
				/>
			))}
		</NativeSection>
	);
}

/** Hours without notifications, and how long a phone waits while you use another screen. */
function QuietSection({ value, onChange }: SectionProps) {
	const quiet = value.quietHours;
	return (
		<>
			<NativeSection
				title="Quiet hours"
				footer={
					quiet
						? `No notifications in these hours. Times are in ${value.timeZone}.`
						: "Night Shift stays silent, then tells you what still waits."
				}
			>
				<NativeToggleRow
					title="Quiet hours"
					value={quiet !== null}
					onChange={(on) =>
						onChange(
							on
								? { quietHours: DEFAULT_QUIET, timeZone: phoneTimeZone() }
								: { quietHours: null },
						)
					}
				/>
				{quiet ? (
					<NativePickerRow
						title="From"
						value={quiet.start}
						options={HOUR_OPTIONS}
						onChange={(start) => onChange({ quietHours: { ...quiet, start } })}
					/>
				) : null}
				{quiet ? (
					<NativePickerRow
						title="Until"
						value={quiet.end}
						options={HOUR_OPTIONS}
						onChange={(end) => onChange({ quietHours: { ...quiet, end } })}
					/>
				) : null}
			</NativeSection>
			<NativeSection footer="While you use another screen, your phones wait this long. A Gate you answer in that time does not reach them.">
				<NativePickerRow
					title="Phone delay"
					value={String(value.holdMinutes)}
					options={DELAY_OPTIONS}
					onChange={(minutes) => onChange({ holdMinutes: Number(minutes) })}
				/>
			</NativeSection>
		</>
	);
}
