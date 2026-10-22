import {
	applySettingsPatch,
	createNotificationMutations,
	createNotificationQueries,
	type NotificationSettings,
	type NotificationSettingsPatch,
	PHONE_DELAYS,
	phoneDelayLabel,
} from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Button } from "@nightshift/ui-native/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Label } from "@nightshift/ui-native/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui-native/components/ui/select";
import { Separator } from "@nightshift/ui-native/components/ui/separator";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Switch } from "@nightshift/ui-native/components/ui/switch";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react-native";
import { Alert as NativeAlert, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useHostQueries } from "@/features/host";
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
	const mutations = useHostQueries(createNotificationMutations);
	const queryClient = useQueryClient();
	const settings = useQuery(queries.settings());
	const key = queries.settings().queryKey;

	const save = useMutation(
		mutations.saveSettings({
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
		<Card>
			<CardHeader>
				<CardTitle>Notifications</CardTitle>
				<CardDescription>
					What Night Shift tells you about, on every screen where you use it.
				</CardDescription>
			</CardHeader>
			<CardContent className="gap-4">
				{settings.data ? (
					<NotificationFields
						value={settings.data}
						onChange={(patch) => save.mutate(patch)}
					/>
				) : settings.error ? (
					<Alert icon={CircleAlert} variant="destructive">
						<AlertTitle>The notification settings did not load</AlertTitle>
						<AlertDescription>{settings.error.message}</AlertDescription>
						<Button
							variant="outline"
							size="sm"
							className="mt-2 self-start"
							onPress={() => void settings.refetch()}
						>
							<Text>Try again</Text>
						</Button>
					</Alert>
				) : (
					<Skeleton className="h-64 w-full" />
				)}
			</CardContent>
		</Card>
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
			<Text variant="small">What Night Shift tells you about</Text>
			<SwitchRow
				label="A Gate waits for you"
				checked={value.events.gateOpened}
				onChange={(on) => onChange({ events: { gateOpened: on } })}
			/>
			<SwitchRow
				label="A run finished"
				checked={value.events.runFinished}
				onChange={(on) => onChange({ events: { runFinished: on } })}
			/>
			<SwitchRow
				label="A run failed"
				checked={value.events.runFailed}
				onChange={(on) => onChange({ events: { runFailed: on } })}
			/>
			<Separator />
			<SwitchRow
				label="Phones"
				hint="When off, your phones get no notifications. The inbox still shows what waits for you."
				checked={value.screens.expo}
				onChange={(on) => onChange({ screens: { expo: on } })}
			/>
			<Separator />
			<SwitchRow
				label="Quiet hours"
				hint={
					quiet
						? `No notifications in these hours. Times are in ${value.timeZone}.`
						: "Choose hours without notifications, for example at night."
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
				<View className="flex-row gap-4">
					<TimeSelect
						label="From"
						value={quiet.start}
						onChange={(start) => onChange({ quietHours: { ...quiet, start } })}
					/>
					<TimeSelect
						label="Until"
						value={quiet.end}
						onChange={(end) => onChange({ quietHours: { ...quiet, end } })}
					/>
				</View>
			) : null}
			<Separator />
			<DelaySelect
				value={value.holdMinutes}
				onChange={(holdMinutes) => onChange({ holdMinutes })}
			/>
		</>
	);
}

/** A label, an optional hint and its Switch, on one row. */
function SwitchRow({
	label,
	hint,
	checked,
	onChange,
}: {
	label: string;
	hint?: string;
	checked: boolean;
	onChange(checked: boolean): void;
}) {
	return (
		<View className="flex-row items-center justify-between gap-4">
			<View className="flex-1 gap-1">
				<Label onPress={() => onChange(!checked)}>{label}</Label>
				{hint ? <Text variant="muted">{hint}</Text> : null}
			</View>
			<Switch
				checked={checked}
				onCheckedChange={onChange}
				accessibilityLabel={label}
			/>
		</View>
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
			<Text variant="muted">
				While you use Night Shift on another screen, your phones wait this long.
				A Gate you answer in that time does not reach your phones.
			</Text>
		</View>
	);
}
