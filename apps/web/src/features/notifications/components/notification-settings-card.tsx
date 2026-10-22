import { PHONE_DELAYS, phoneDelayLabel } from "@nightshift/client";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSeparator,
	FieldSet,
} from "@nightshift/ui/components/field";
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
import { useQuery } from "@tanstack/react-query";
import { BellOffIcon, CircleAlertIcon, SquarePlusIcon } from "lucide-react";
import { useId, useMemo } from "react";
import { toast } from "sonner";

import type { NotificationSettings } from "@/shared/api";
import { PageSection } from "@/shared/page";
import { browserPushErrorText } from "../browser";
import { notificationQueries } from "../queries";
import { useBrowserPush } from "../use-browser-push";
import { useSaveSettings } from "../use-save-settings";
import { ScreensCard } from "./screens-card";

const EVENTS: {
	key: keyof NotificationSettings["events"];
	label: string;
	description: string;
}[] = [
	{
		key: "gateOpened",
		label: "A Gate waits for you",
		description: "A run waits for your answer.",
	},
	{
		key: "runFinished",
		label: "A run finished",
		description: "A run ended with its outcome.",
	},
	{
		key: "runFailed",
		label: "A run failed",
		description: "A run stopped on an error.",
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
		description: "Each browser where you turned on notifications.",
	},
	{
		key: "desktop",
		label: "Desktop app",
		description: "The Night Shift app on your computers.",
	},
	{
		key: "expo",
		label: "Phones",
		description:
			"When off, your phones get no notifications. The inbox still shows what waits for you.",
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
				description="What Night Shift tells you about, when, and where. These settings are the same on every screen you use."
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
	const zones = useMemo(() => timeZones(data.timeZone), [data.timeZone]);

	return (
		<Card>
			<CardContent>
				<FieldGroup>
					<BrowserField />
					<FieldSeparator />
					<FieldSet>
						<FieldLegend>What Night Shift tells you about</FieldLegend>
						<FieldGroup>
							{EVENTS.map(({ key, label, description }) => (
								<Field key={key} orientation="horizontal">
									<FieldContent>
										<FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
										<FieldDescription>{description}</FieldDescription>
									</FieldContent>
									<Switch
										id={`${id}-${key}`}
										checked={data.events[key]}
										onCheckedChange={(checked) =>
											save.mutate({ events: { [key]: checked } })
										}
									/>
								</Field>
							))}
						</FieldGroup>
					</FieldSet>
					<FieldSeparator />
					<FieldSet>
						<FieldGroup>
							<Field orientation="horizontal">
								<FieldContent>
									<FieldLabel htmlFor={`${id}-quiet`}>Quiet hours</FieldLabel>
									<FieldDescription>
										When quiet hours end, Night Shift tells you what still waits
										for you.
									</FieldDescription>
								</FieldContent>
								<Switch
									id={`${id}-quiet`}
									checked={data.quietHours !== null}
									onCheckedChange={(checked) =>
										save.mutate({
											quietHours: checked ? DEFAULT_QUIET : null,
										})
									}
								/>
							</Field>
							{data.quietHours ? (
								<div className="grid gap-4 sm:grid-cols-3">
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
									<Field>
										<FieldLabel htmlFor={`${id}-zone`}>Time zone</FieldLabel>
										<Select
											items={zones.map((zone) => ({
												value: zone,
												label: zone.replace(/_/g, " "),
											}))}
											value={data.timeZone}
											onValueChange={(zone) => {
												if (zone) save.mutate({ timeZone: zone });
											}}
										>
											<SelectTrigger id={`${id}-zone`} className="w-full">
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
									</Field>
								</div>
							) : null}
						</FieldGroup>
					</FieldSet>
					<FieldSeparator />
					<FieldSet>
						<FieldLegend>Where Night Shift tells you</FieldLegend>
						<FieldDescription>
							An open Night Shift page always shows what happens.
						</FieldDescription>
						<FieldGroup>
							{SCREENS.map(({ key, label, description }) => (
								<Field key={key} orientation="horizontal">
									<FieldContent>
										<FieldLabel htmlFor={`${id}-screen-${key}`}>
											{label}
										</FieldLabel>
										<FieldDescription>{description}</FieldDescription>
									</FieldContent>
									<Switch
										id={`${id}-screen-${key}`}
										checked={data.screens[key]}
										onCheckedChange={(checked) =>
											save.mutate({ screens: { [key]: checked } })
										}
									/>
								</Field>
							))}
							<Field>
								<FieldLabel htmlFor={`${id}-hold`}>Phone delay</FieldLabel>
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
										className="w-full sm:w-56"
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
								<FieldDescription id={`${id}-hold-description`}>
									While you use Night Shift on another screen, phones and closed
									browsers wait this long. A Gate you answer meanwhile does not
									reach them.
								</FieldDescription>
							</Field>
						</FieldGroup>
					</FieldSet>
				</FieldGroup>
			</CardContent>
		</Card>
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
		<Field>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
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
		</Field>
	);
}

/** This browser: on or off, and what stops it. */
function BrowserField() {
	const id = useId();
	const push = useBrowserPush();

	return (
		<>
			<Field orientation="horizontal">
				<FieldContent>
					<FieldLabel htmlFor={`${id}-browser`}>
						Notifications in this browser
					</FieldLabel>
					<FieldDescription>
						Night Shift tells you here, also when no Night Shift page is open.
					</FieldDescription>
				</FieldContent>
				{push.busy || push.state === "loading" ? (
					<Spinner aria-label="Checking this browser" />
				) : null}
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
			</Field>
			{push.state === "denied" ? (
				<Alert>
					<BellOffIcon />
					<AlertTitle>This browser blocks notifications</AlertTitle>
					<AlertDescription>
						Allow notifications for this site in the browser's site settings
						(the icon left of the address). On macOS, also allow the browser in
						System Settings, Notifications.
					</AlertDescription>
				</Alert>
			) : push.state === "home-screen" ? (
				<Alert>
					<SquarePlusIcon />
					<AlertTitle>Add Night Shift to your Home Screen</AlertTitle>
					<AlertDescription>
						An iPhone or iPad sends notifications only to apps on its Home
						Screen. Tap Share, then Add to Home Screen. Open Night Shift from
						there and turn this on.
					</AlertDescription>
				</Alert>
			) : push.state === "unsupported" ? (
				<Alert>
					<BellOffIcon />
					<AlertTitle>No notifications in this browser</AlertTitle>
					<AlertDescription>
						This browser cannot get notifications from this address. Open Night
						Shift at its secure address, which starts with https.
					</AlertDescription>
				</Alert>
			) : null}
		</>
	);
}
