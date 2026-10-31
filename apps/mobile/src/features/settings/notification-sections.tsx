import {
	type NotificationSettings,
	type NotificationSettingsPatch,
	PHONE_DELAYS,
	phoneDelayLabel,
} from "@nightshift/client";
import { Label } from "@nightshift/ui-native/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui-native/components/ui/select";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorAlert } from "@/shared/feedback";
import { ListGroup, SectionHead, SwitchRow } from "@/shared/list";
import {
	type Choice,
	digestOptions,
	digestPatch,
	digestValue,
	HOURS,
	phoneTimeZone,
} from "./notification-choices";
import {
	useNotificationSettings,
	useSaveNotificationSettings,
} from "./use-notification-settings";

/** Quiet hours when the person turns them on: the night. */
const DEFAULT_QUIET = { start: "22:00", end: "07:00" };

/**
 * The person's notification settings, in three sections: the morning
 * digest, what Night Shift tells them about, and quiet hours. They apply
 * on every screen. Each change saves at once.
 */
export function NotificationSections() {
	const settings = useNotificationSettings();
	const save = useSaveNotificationSettings();

	if (settings.data) {
		return (
			<>
				<DigestSection value={settings.data} onChange={save} />
				<TellMeSection value={settings.data} onChange={save} />
				<QuietSection value={settings.data} onChange={save} />
			</>
		);
	}
	return (
		<View className="gap-3">
			<SectionHead title="Notifications" />
			{settings.error ? (
				<ErrorAlert
					title="The notification settings did not load"
					message={settings.error.message}
					fix="Check that this phone is online, then try again."
					onRetry={() => void settings.refetch()}
				/>
			) : (
				<Skeleton className="h-64 w-full rounded-xl" />
			)}
		</View>
	);
}

type SectionProps = {
	value: NotificationSettings;
	onChange(patch: NotificationSettingsPatch): void;
};

/**
 * When the morning digest comes, or off. Without quiet hours, the time
 * zone comes from the phone with each change, as it does when you turn
 * quiet hours on.
 */
function DigestSection({ value, onChange }: SectionProps) {
	const zone = value.quietHours ? {} : { timeZone: phoneTimeZone() };
	const otherZone = value.timeZone !== phoneTimeZone();
	return (
		<View className="gap-3">
			<SectionHead title="Morning digest" />
			<OptionSelect
				label="It comes at"
				options={digestOptions(value)}
				value={digestValue(value)}
				onChange={(choice) => onChange({ ...digestPatch(choice), ...zone })}
			/>
			<Text variant="muted" className="text-muted-foreground">
				What the night did, in one notification.
				{otherZone ? ` The time is in ${value.timeZone}.` : ""}
			</Text>
		</View>
	);
}

/** Which events reach the person, and whether phones get them at all. */
function TellMeSection({ value, onChange }: SectionProps) {
	return (
		<View className="gap-3">
			<SectionHead title="Tell me about" />
			<ListGroup>
				<SwitchRow
					title="Gates"
					caption="When a run waits for your answer"
					checked={value.events.gateOpened}
					onChange={(on) => onChange({ events: { gateOpened: on } })}
				/>
				<SwitchRow
					title="Runs that stop"
					caption="When a run fails or stops early"
					checked={value.events.runFailed}
					onChange={(on) => onChange({ events: { runFailed: on } })}
				/>
				<SwitchRow
					title="Runs that finish"
					caption="When a run is done"
					checked={value.events.runFinished}
					onChange={(on) => onChange({ events: { runFinished: on } })}
				/>
				<SwitchRow
					title="Offline computers"
					caption="When a step waits for a computer that is offline"
					checked={value.events.deviceWait}
					onChange={(on) => onChange({ events: { deviceWait: on } })}
				/>
			</ListGroup>
			<ListGroup>
				<SwitchRow
					title="Phones"
					caption="When off, your phones get no notifications. Needs you still shows what waits."
					checked={value.screens.expo}
					onChange={(on) => onChange({ screens: { expo: on } })}
				/>
			</ListGroup>
		</View>
	);
}

/** Hours without notifications, and how long a phone waits while you use another screen. */
function QuietSection({ value, onChange }: SectionProps) {
	const quiet = value.quietHours;
	const hours = HOURS.map((hour) => ({ value: hour, label: hour }));
	return (
		<View className="gap-3">
			<SectionHead title="Quiet hours" />
			<ListGroup>
				<SwitchRow
					title="Quiet hours"
					caption={
						quiet
							? `No notifications in these hours. Times are in ${value.timeZone}.`
							: "Night Shift stays silent, then tells you what still waits."
					}
					checked={quiet !== null}
					onChange={(on) =>
						onChange(
							on
								? { quietHours: DEFAULT_QUIET, timeZone: phoneTimeZone() }
								: { quietHours: null },
						)
					}
				/>
				{quiet ? (
					<View className="flex-row gap-4 px-4 py-3">
						<View className="flex-1">
							<OptionSelect
								label="From"
								options={hours}
								value={quiet.start}
								onChange={(start) =>
									onChange({ quietHours: { ...quiet, start } })
								}
							/>
						</View>
						<View className="flex-1">
							<OptionSelect
								label="Until"
								options={hours}
								value={quiet.end}
								onChange={(end) => onChange({ quietHours: { ...quiet, end } })}
							/>
						</View>
					</View>
				) : null}
			</ListGroup>
			<OptionSelect
				label="Phone delay"
				options={PHONE_DELAYS.map((minutes) => ({
					value: String(minutes),
					label: phoneDelayLabel(minutes),
				}))}
				value={String(value.holdMinutes)}
				onChange={(minutes) => onChange({ holdMinutes: Number(minutes) })}
			/>
			<Text variant="muted" className="text-muted-foreground">
				While you use another screen, your phones wait this long. A Gate you
				answer in that time does not reach them.
			</Text>
		</View>
	);
}

/** A label and a Select of one of a list of options. */
function OptionSelect({
	label,
	options,
	value,
	onChange,
}: {
	label: string;
	options: Choice[];
	value: string;
	onChange(value: string): void;
}) {
	const insets = useSafeAreaInsets();
	const chosen = options.find((option) => option.value === value);
	return (
		<View className="gap-2">
			<Label>{label}</Label>
			<Select
				value={chosen}
				onValueChange={(option) => option && onChange(option.value)}
			>
				<SelectTrigger
					accessibilityLabel={label}
					accessibilityValue={{ text: chosen?.label ?? "" }}
				>
					<SelectValue placeholder="Choose" />
				</SelectTrigger>
				<SelectContent insets={{ top: insets.top, bottom: insets.bottom }}>
					<ScrollView className="max-h-64">
						{options.map((option) => (
							<SelectItem
								key={option.value}
								value={option.value}
								label={option.label}
							/>
						))}
					</ScrollView>
				</SelectContent>
			</Select>
		</View>
	);
}
