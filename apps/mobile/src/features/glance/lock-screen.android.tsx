import {
	Column,
	LinearProgressIndicator,
	Row,
	Text,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth, paddingAll } from "@expo/ui/jetpack-compose/modifiers";
import {
	type CustomNotificationEnvironment,
	type CustomNotificationFactory,
	createCustomNotification,
} from "expo-widgets";
import { PermissionsAndroid, Platform } from "react-native";

import { type RunActivityProps, runActivityProps } from "./glance-props";
import type { LockScreenPort } from "./lock-screen-port";

/** How long an ended run stays in the notification shade. */
const ENDED_STAYS_MS = 30 * 60_000;
/**
 * A notification the app has not updated for this long goes away. Each
 * update starts the time again, so a run the app cannot follow any more
 * (the app was closed) does not stay in the shade for good.
 */
const UNTOUCHED_STAYS_MS = 60 * 60_000;

/**
 * A followed run as an ongoing notification: its flow, the step that runs
 * now, a progress bar, step x of y and the status. A `'widget'` function
 * runs in its own runtime: it may use only its props, its environment and
 * `@expo/ui` components.
 */
const layout = (
	props: RunActivityProps,
	environment: CustomNotificationEnvironment,
) => {
	"widget";
	const dark = environment.colorScheme === "dark";
	const color = dark ? props.dark : props.light;
	const text = dark ? "#fafafa" : "#0a0a0a";
	const muted = dark ? "#a1a1a1" : "#737373";
	const line = props.step
		? `${props.position} · ${props.step}`
		: props.position;
	return {
		collapsed: (
			<Column modifiers={[fillMaxWidth()]}>
				<Row>
					<Text
						color={text}
						maxLines={1}
						style={{ fontSize: 14, fontWeight: "600" }}
					>
						{`${props.flow}  `}
					</Text>
					<Text color={color} maxLines={1} style={{ fontSize: 14 }}>
						{props.statusText}
					</Text>
				</Row>
				<Text color={muted} maxLines={1} style={{ fontSize: 13 }}>
					{line}
				</Text>
				<LinearProgressIndicator
					progress={props.fraction}
					color={color}
					modifiers={[fillMaxWidth()]}
				/>
			</Column>
		),
		expanded: (
			<Column modifiers={[fillMaxWidth(), paddingAll(4)]}>
				<Text
					color={text}
					maxLines={1}
					style={{ fontSize: 15, fontWeight: "600" }}
				>
					{props.flow}
				</Text>
				<Text color={color} maxLines={1} style={{ fontSize: 14 }}>
					{props.statusText}
				</Text>
				{props.step ? (
					<Text color={text} maxLines={1} style={{ fontSize: 14 }}>
						{props.step}
					</Text>
				) : null}
				<LinearProgressIndicator
					progress={props.fraction}
					color={color}
					modifiers={[fillMaxWidth()]}
				/>
				<Text color={muted} maxLines={1} style={{ fontSize: 13 }}>
					{props.position}
				</Text>
			</Column>
		),
	};
};

let factory: CustomNotificationFactory<RunActivityProps> | null = null;

/** The notifications of followed runs, made on first use (not when the app starts). */
function runNotification(): CustomNotificationFactory<RunActivityProps> {
	factory ??= createCustomNotification("RunProgress", layout);
	return factory;
}

/** Asks for leave to post notifications (Android 13 and later need it). */
async function allowNotifications(): Promise<boolean> {
	if (Platform.OS !== "android" || Platform.Version < 33) return true;
	const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
	if (await PermissionsAndroid.check(permission)) return true;
	return (
		(await PermissionsAndroid.request(permission)) ===
		PermissionsAndroid.RESULTS.GRANTED
	);
}

/**
 * Android: an ongoing notification per followed run, posted and updated
 * from the app while it runs, with the run id as its key. A tap opens the
 * run. When the run ends, the notification can be swiped away and goes
 * after a while.
 */
export const lockScreen: LockScreenPort = {
	available: true,
	refusedText:
		"Your phone does not let Night Shift show notifications. Turn them on in Settings > Apps > Night Shift, then try again.",
	allow: allowNotifications,
	show: async (runId, progress) => {
		const notification = await runNotification().post(
			runActivityProps(progress),
			{
				id: runId,
				ongoing: true,
				title: progress.flow,
				text: progress.statusText,
				timeoutAfter: UNTOUCHED_STAYS_MS,
				url: `nightshift://runs/${runId}`,
			},
		);
		return notification.id;
	},
	update: async (key, progress) => {
		const notification = await runNotification().get(key);
		if (!notification) return false;
		await notification.update(runActivityProps(progress), {
			title: progress.flow,
			text: progress.statusText,
			timeoutAfter: UNTOUCHED_STAYS_MS,
		});
		return true;
	},
	end: async (key, progress) => {
		const notification = await runNotification().get(key);
		await notification?.update(runActivityProps(progress), {
			title: progress.flow,
			text: progress.statusText,
			ongoing: false,
			timeoutAfter: ENDED_STAYS_MS,
		});
	},
	remove: async (key) => {
		await (await runNotification().get(key))?.cancel();
	},
};
