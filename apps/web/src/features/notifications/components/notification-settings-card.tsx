import {
	PHONE_DELAYS,
	phoneDelayLabel,
	URGENCY_LABEL,
} from "@nightshift/client";
import { GATE_URGENCIES, type GateUrgency } from "@nightshift/flows";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Input } from "@nightshift/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { Switch } from "@nightshift/ui/components/switch";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { BellOffIcon, CircleAlertIcon, SquarePlusIcon } from "lucide-react";
import { useId, useMemo } from "react";
import { toast } from "sonner";

import type { NotificationSettings } from "@/shared/api";
import {
	PageSection,
	SettingNote,
	SettingRow,
	SettingRows,
} from "@/shared/page";
import { UrgencyMarker } from "@/shared/urgency";
import { browserPushErrorText } from "../browser";
import { notificationQueries } from "../queries";
import { useBrowserPush } from "../use-browser-push";
import { useSaveSettings } from "../use-save-settings";
import { ScreensCard } from "./screens-card";

const EVENTS: {
	key: keyof NotificationSettings["events"];
	label: string;
	description?: string;
}[] = [
	{ key: "gateOpened", label: "A Gate waits for you" },
	{
		key: "runFinished",
		label: "A run finished",
	},
	{
		key: "runFailed",
		label: "A run failed",
	},
	{
		key: "deviceWait",
		label: "A step waits for a device",
		description: "A run waits until an offline device is back.",
	},
];

const SCREENS: {
	key: keyof NotificationSettings["screens"];
	label: string;
	description: string;
}[] = [
	{
		key: "web",
		label: "Browsers",
		description: "Each browser where you turned them on.",
	},
	{
		key: "desktop",
		label: "Desktop app",
		description: "The Night Shift app on your computers.",
	},
	{
		key: "expo",
		label: "Phones",
		description: "The Night Shift app on your phones.",
	},
];

/** Quiet hours when you turn them on. */
const DEFAULT_QUIET = { start: "22:00", end: "07:00" };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The time zones this browser knows, with the one of the settings in it. */
function timeZones(current: string): string[] {
	let zones: string[] = [];
	try {
		zones = Intl.supportedValuesOf("timeZone");
	} catch {
		zones = [];
	}
	return zones.includes(current) ? zones : [current, ...zones];
}

/**
 * Your notification settings, on every screen: which events, quiet hours,
 * which kinds of screen, and how long a phone waits. Each change saves at
 * once. Then the phones and browsers that can notify you.
 */
export function NotificationSettingsCard() {
	const settings = useQuery(notificationQueries.settings());

	return (
		<>
			<PageSection
				title="Notifications"
				description="Choose what Night Shift tells you about, when, and where. This applies on every screen."
			>
				{settings.data ? (
					<SettingsForm data={settings.data} />
				) : settings.error ? (
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertTitle>Your notification settings did not load</AlertTitle>
						<AlertDescription>{settings.error.message}</AlertDescription>
						<AlertAction>
							<Button
								variant="outline"
								size="sm"
								disabled={settings.isFetching}
								onClick={() => void settings.refetch()}
							>
								{settings.isFetching ? (
									<Spinner data-icon="inline-start" />
								) : null}
								Try again
							</Button>
						</AlertAction>
					</Alert>
				) : (
					<Skeleton className="h-96 w-full rounded-xl" />
				)}
			</PageSection>
			<ScreensCard />
		</>
	);
}

function SettingsForm({ data }: { data: NotificationSettings }) {
	const id = useId();
	const save = useSaveSettings();

	return (
		<>
			<SettingRows first="What Night Shift tells you about" second="On">
				{EVENTS.map(({ key, label, description }) => (
					<SettingRow
						key={key}
						label={label}
						htmlFor={`${id}-${key}`}
						description={description}
					>
						<Switch
							id={`${id}-${key}`}
							checked={data.events[key]}
							onCheckedChange={(checked) =>
								save.mutate({ events: { [key]: checked } })
							}
						/>
					</SettingRow>
				))}
				{data.events.gateOpened ? (
					<PushForField
						value={data.pushUrgencies}
						onSave={(pushUrgencies) => save.mutate({ pushUrgencies })}
					/>
				) : null}
			</SettingRows>
			<SettingRows first="When">
				<SettingRow
					label="Quiet hours"
					htmlFor={`${id}-quiet`}
					description="Night Shift stays silent, then tells you what still waits."
				>
					<Switch
						id={`${id}-quiet`}
						checked={data.quietHours !== null}
						onCheckedChange={(checked) =>
							save.mutate({
								quietHours: checked ? DEFAULT_QUIET : null,
							})
						}
					/>
				</SettingRow>
				{data.quietHours ? (
					<>
						<TimeField
							label="From"
							value={data.quietHours.start}
							onSave={(start) =>
								data.quietHours &&
								save.mutate({
									quietHours: { ...data.quietHours, start },
								})
							}
						/>
						<TimeField
							label="Until"
							value={data.quietHours.end}
							onSave={(end) =>
								data.quietHours &&
								save.mutate({ quietHours: { ...data.quietHours, end } })
							}
						/>
						<TimeZoneField
							value={data.timeZone}
							onSave={(zone) => save.mutate({ timeZone: zone })}
						/>
					</>
				) : null}
			</SettingRows>
			<SettingRows first="Where Night Shift tells you" second="On">
				<BrowserField />
				{SCREENS.map(({ key, label, description }) => (
					<SettingRow
						key={key}
						label={label}
						htmlFor={`${id}-screen-${key}`}
						description={description}
					>
						<Switch
							id={`${id}-screen-${key}`}
							checked={data.screens[key]}
							onCheckedChange={(checked) =>
								save.mutate({ screens: { [key]: checked } })
							}
						/>
					</SettingRow>
				))}
				<SettingRow
					label="Phone delay"
					htmlFor={`${id}-hold`}
					description={
						<span id={`${id}-hold-description`}>
							While you use another screen, phones and closed browsers wait this
							long. A Gate you answer in that time does not reach them.
						</span>
					}
				>
					<Select
						items={PHONE_DELAYS.map((minutes) => ({
							value: minutes,
							label: phoneDelayLabel(minutes),
						}))}
						value={data.holdMinutes}
						onValueChange={(minutes) => {
							if (minutes !== null) save.mutate({ holdMinutes: minutes });
						}}
					>
						<SelectTrigger
							id={`${id}-hold`}
							className="w-full"
							aria-describedby={`${id}-hold-description`}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{PHONE_DELAYS.map((minutes) => (
									<SelectItem key={minutes} value={minutes}>
										{phoneDelayLabel(minutes)}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</SettingRow>
				<SettingNote>
					<span className="text-muted-foreground text-xs">
						An open Night Shift page always shows what happens.
					</span>
				</SettingNote>
			</SettingRows>
		</>
	);
}

/**
 * The Gate urgencies that send a notification. A Gate of another level
 * waits in the inbox only. One level at least stays on: to stop them all,
 * turn off "A Gate waits for you".
 */
function PushForField({
	value,
	onSave,
}: {
	value: GateUrgency[];
	onSave: (value: GateUrgency[]) => void;
}) {
	const id = useId();
	return (
		<SettingRow
			label={<span id={id}>Push for</span>}
			description={
				<span id={`${id}-description`}>
					Gates of the other levels wait in your inbox without a notification.
				</span>
			}
		>
			<ToggleGroup
				multiple
				variant="outline"
				size="sm"
				spacing={0}
				aria-labelledby={id}
				aria-describedby={`${id}-description`}
				value={value}
				onValueChange={(next: string[]) => {
					const levels = GATE_URGENCIES.filter((level) => next.includes(level));
					if (levels.length > 0) onSave(levels);
				}}
				className="flex-wrap"
			>
				{GATE_URGENCIES.map((level) => (
					<ToggleGroupItem key={level} value={level}>
						<UrgencyMarker urgency={level} />
						{URGENCY_LABEL[level]}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</SettingRow>
	);
}

/** Your time zone: quiet hours are in it. */
function TimeZoneField({
	value,
	onSave,
}: {
	value: string;
	onSave: (zone: string) => void;
}) {
	const id = useId();
	const zones = useMemo(() => timeZones(value), [value]);
	return (
		<SettingRow label="Time zone" htmlFor={id}>
			<Select
				items={zones.map((zone) => ({
					value: zone,
					label: zone.replace(/_/g, " "),
				}))}
				value={value}
				onValueChange={(zone) => {
					if (zone) onSave(zone);
				}}
			>
				<SelectTrigger id={id} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{zones.map((zone) => (
							<SelectItem key={zone} value={zone}>
								{zone.replace(/_/g, " ")}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</SettingRow>
	);
}

/** A time of day. It saves when you leave the field or press Enter. */
function TimeField({
	label,
	value,
	onSave,
}: {
	label: string;
	value: string;
	onSave: (value: string) => void;
}) {
	const id = useId();
	return (
		<SettingRow label={label} htmlFor={id}>
			<Input
				id={id}
				type="time"
				defaultValue={value}
				key={value}
				onBlur={(event) => {
					const next = event.target.value;
					if (TIME.test(next) && next !== value) onSave(next);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") event.currentTarget.blur();
				}}
			/>
		</SettingRow>
	);
}

/** This browser: on or off, and what stops it. */
function BrowserField() {
	const id = useId();
	const push = useBrowserPush();

	return (
		<>
			<SettingRow
				label="This browser"
				htmlFor={`${id}-browser`}
				description="Get notifications here, also when Night Shift is closed."
			>
				<Switch
					id={`${id}-browser`}
					checked={push.state === "on"}
					disabled={
						push.busy ||
						push.state === "loading" ||
						push.state === "home-screen" ||
						push.state === "unsupported" ||
						push.state === "denied"
					}
					onCheckedChange={(checked) => {
						const change = checked ? push.turnOn() : push.turnOff();
						change.catch((error: unknown) =>
							toast.error(browserPushErrorText(error, checked)),
						);
					}}
				/>
				{push.busy || push.state === "loading" ? (
					<Spinner aria-label="Checking this browser" />
				) : null}
			</SettingRow>
			{push.state === "denied" ? (
				<SettingNote>
					<Alert>
						<BellOffIcon />
						<AlertTitle>This browser blocks notifications</AlertTitle>
						<AlertDescription>
							Allow notifications for this site in the site settings of the
							browser. On macOS, also allow the browser in System Settings,
							Notifications.
						</AlertDescription>
					</Alert>
				</SettingNote>
			) : push.state === "home-screen" ? (
				<SettingNote>
					<Alert>
						<SquarePlusIcon />
						<AlertTitle>Add Night Shift to your Home Screen</AlertTitle>
						<AlertDescription>
							An iPhone or iPad sends notifications only to apps on its Home
							Screen. Tap Share, then Add to Home Screen. Open Night Shift from
							there and turn this on.
						</AlertDescription>
					</Alert>
				</SettingNote>
			) : push.state === "unsupported" ? (
				<SettingNote>
					<Alert>
						<BellOffIcon />
						<AlertTitle>No notifications in this browser</AlertTitle>
						<AlertDescription>
							Open Night Shift at its https:// address to get notifications.
						</AlertDescription>
					</Alert>
				</SettingNote>
			) : null}
		</>
	);
}
