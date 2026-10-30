import {
	applySettingsPatch,
	createNotificationQueries,
	type NotificationSettings,
	type NotificationSettingsPatch,
	PHONE_DELAYS,
	phoneDelayLabel,
} from "@nightshift/client";
import { Card, CardContent } from "@nightshift/ui-native/components/ui/card";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert as NativeAlert, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useHostQueries, useSignedIn } from "@/features/host";
import { ErrorAlert } from "@/shared/feedback";
import { ListGroup, SectionHead, SwitchRow } from "@/shared/list";
import { HOURS, phoneTimeZone } from "./notification-choices";

/** Quiet hours when the person turns them on: the night. */
const DEFAULT_QUIET = { start: "22:00", end: "07:00" };

/**
 * The person's notification settings, the same on every screen: which
 * events, the phones, quiet hours and the phone delay. Each change saves
 * at once.
 */
export function NotificationsCard() {
	const queries = useHostQueries(createNotificationQueries);
	const { host } = useSignedIn();
	const queryClient = useQueryClient();
	const settings = useQuery(queries.settings());
	const key = queries.settings().queryKey;

	const save = useMutation(
		host.orpc.notifications.settings.save.mutationOptions({
			onMutate: async (patch: NotificationSettingsPatch) => {
				await queryClient.cancelQueries({ queryKey: key });
				const before = queryClient.getQueryData<NotificationSettings>(key);
				if (before)
					queryClient.setQueryData(key, applySettingsPatch(before, patch));
				return { before };
			},
			onSuccess: (saved) => queryClient.setQueryData(key, saved),
			onError: (error, _patch, context) => {
				if (context?.before) queryClient.setQueryData(key, context.before);
				NativeAlert.alert("The change was not saved", error.message);
			},
		}),
	);

	return (
		<View className="gap-3">
			<SectionHead
				title="Notifications"
				hint="Choose what Night Shift tells you about. This applies on every screen."
			/>
			{settings.data ? (
				<NotificationFields
					value={settings.data}
					onChange={(patch) => save.mutate(patch)}
				/>
			) : settings.error ? (
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

function NotificationFields({
	value,
	onChange,
}: {
	value: NotificationSettings;
	onChange(patch: NotificationSettingsPatch): void;
}) {
	const quiet = value.quietHours;
	return (
		<>
			<ListGroup>
				<SwitchRow
					title="A Gate waits for you"
					checked={value.events.gateOpened}
					onChange={(on) => onChange({ events: { gateOpened: on } })}
				/>
				<SwitchRow
					title="A run finished"
					checked={value.events.runFinished}
					onChange={(on) => onChange({ events: { runFinished: on } })}
				/>
				<SwitchRow
					title="A run failed"
					checked={value.events.runFailed}
					onChange={(on) => onChange({ events: { runFailed: on } })}
				/>
				<SwitchRow
					title="A step waits for a device"
					checked={value.events.deviceWait}
					onChange={(on) => onChange({ events: { deviceWait: on } })}
				/>
			</ListGroup>
			<ListGroup>
				<SwitchRow
					title="Phones"
					caption="When off, your phones get no notifications. The inbox still shows what waits."
					checked={value.screens.expo}
					onChange={(on) => onChange({ screens: { expo: on } })}
				/>
			</ListGroup>
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
						<TimeSelect
							label="From"
							value={quiet.start}
							onChange={(start) =>
								onChange({ quietHours: { ...quiet, start } })
							}
						/>
						<TimeSelect
							label="Until"
							value={quiet.end}
							onChange={(end) => onChange({ quietHours: { ...quiet, end } })}
						/>
					</View>
				) : null}
			</ListGroup>
			<Card className="py-4">
				<CardContent className="px-4">
					<DelaySelect
						value={value.holdMinutes}
						onChange={(holdMinutes) => onChange({ holdMinutes })}
					/>
				</CardContent>
			</Card>
		</>
	);
}

/** A time of day, by the hour. */
function TimeSelect({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange(value: string): void;
}) {
	const insets = useSafeAreaInsets();
	return (
		<View className="flex-1 gap-2">
			<Label>{label}</Label>
			<Select
				value={{ value, label: value }}
				onValueChange={(option) => option && onChange(option.value)}
			>
				<SelectTrigger accessibilityLabel={label}>
					<SelectValue placeholder="Choose a time" />
				</SelectTrigger>
				<SelectContent insets={{ top: insets.top, bottom: insets.bottom }}>
					<ScrollView className="max-h-64">
						{HOURS.map((hour) => (
							<SelectItem key={hour} value={hour} label={hour} />
						))}
					</ScrollView>
				</SelectContent>
			</Select>
		</View>
	);
}

/** How long a phone waits while another screen is open. */
function DelaySelect({
	value,
	onChange,
}: {
	value: number;
	onChange(minutes: number): void;
}) {
	const insets = useSafeAreaInsets();
	return (
		<View className="gap-2">
			<Label>Phone delay</Label>
			<Select
				value={{ value: String(value), label: phoneDelayLabel(value) }}
				onValueChange={(option) => option && onChange(Number(option.value))}
			>
				<SelectTrigger accessibilityLabel="Phone delay">
					<SelectValue placeholder="Choose a delay" />
				</SelectTrigger>
				<SelectContent insets={{ top: insets.top, bottom: insets.bottom }}>
					<ScrollView className="max-h-64">
						{PHONE_DELAYS.map((minutes) => (
							<SelectItem
								key={minutes}
								value={String(minutes)}
								label={phoneDelayLabel(minutes)}
							/>
						))}
					</ScrollView>
				</SelectContent>
			</Select>
			<Text variant="muted" className="text-muted-foreground">
				While you use another screen, your phones wait this long. A Gate you
				answer in that time does not reach them.
			</Text>
		</View>
	);
}
