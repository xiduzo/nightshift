import {
	HStack,
	Image,
	ProgressView,
	Spacer,
	Text,
	VStack,
} from "@expo/ui/swift-ui";
import {
	font,
	foregroundStyle,
	lineLimit,
	padding,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import {
	createLiveActivity,
	type LiveActivity,
	type LiveActivityEnvironment,
	type LiveActivityFactory,
} from "expo-widgets";

import { type RunActivityProps, runActivityProps } from "./glance-props";
import type { LockScreenPort } from "./lock-screen-port";

/** After this long without an update, iOS shows the activity as out of date. */
const STALE_MS = 10 * 60_000;
/** How long an ended run stays on the lock screen. */
const ENDED_STAYS_MS = 30 * 60_000;

/**
 * A followed run as a Live Activity: the lock screen and the Dynamic
 * Island show its flow, the step that runs now, step x of y and the
 * status. A `'widget'` function runs in the widget's own runtime: it may
 * use only its props, its environment and `@expo/ui` components.
 */
const layout = (
	props: RunActivityProps,
	environment: LiveActivityEnvironment,
) => {
	"widget";
	const color = environment.colorScheme === "dark" ? props.dark : props.light;
	const detail =
		environment.isStale && !props.ended ? props.staleText : props.position;
	const short = props.ended
		? props.statusText
		: props.position.replace("Step ", "");
	return {
		banner: (
			<VStack
				alignment="leading"
				spacing={6}
				modifiers={[padding({ all: 16 })]}
			>
				<HStack spacing={8}>
					<Text
						modifiers={[font({ weight: "semibold", size: 17 }), lineLimit(1)]}
					>
						{props.flow}
					</Text>
					<Spacer />
					<Text
						modifiers={[
							font({ weight: "medium", size: 15 }),
							foregroundStyle(color),
						]}
					>
						{props.statusText}
					</Text>
				</HStack>
				{props.step ? (
					<Text modifiers={[font({ size: 15 }), lineLimit(1)]}>
						{props.step}
					</Text>
				) : null}
				<ProgressView value={props.fraction} modifiers={[tint(color)]} />
				<Text
					modifiers={[
						font({ size: 13 }),
						foregroundStyle({ type: "hierarchical", style: "secondary" }),
					]}
				>
					{detail}
				</Text>
			</VStack>
		),
		compactLeading: <Image systemName="moon.stars.fill" color={color} />,
		compactTrailing: (
			<Text
				modifiers={[
					font({ size: 13, weight: "medium" }),
					foregroundStyle(color),
				]}
			>
				{short}
			</Text>
		),
		minimal: <Image systemName="moon.stars.fill" color={color} />,
		expandedLeading: (
			<VStack alignment="leading" modifiers={[padding({ leading: 8, top: 8 })]}>
				<Text
					modifiers={[font({ weight: "semibold", size: 15 }), lineLimit(1)]}
				>
					{props.flow}
				</Text>
			</VStack>
		),
		expandedTrailing: (
			<VStack
				alignment="trailing"
				modifiers={[padding({ trailing: 8, top: 8 })]}
			>
				<Text
					modifiers={[
						font({ weight: "medium", size: 15 }),
						foregroundStyle(color),
					]}
				>
					{props.statusText}
				</Text>
			</VStack>
		),
		expandedBottom: (
			<VStack
				alignment="leading"
				spacing={6}
				modifiers={[padding({ horizontal: 8, bottom: 8 })]}
			>
				{props.step ? (
					<Text modifiers={[font({ size: 15 }), lineLimit(1)]}>
						{props.step}
					</Text>
				) : null}
				<ProgressView value={props.fraction} modifiers={[tint(color)]} />
				<Text
					modifiers={[
						font({ size: 13 }),
						foregroundStyle({ type: "hierarchical", style: "secondary" }),
					]}
				>
					{detail}
				</Text>
			</VStack>
		),
	};
};

let factory: LiveActivityFactory<RunActivityProps> | null = null;

/** The Live Activities of followed runs, made on first use (not when the app starts). */
function runActivity(): LiveActivityFactory<RunActivityProps> {
	factory ??= createLiveActivity("RunProgress", layout);
	return factory;
}

/** The Live Activity with this id, when it still runs. */
function activityOf(key: string): LiveActivity<RunActivityProps> | null {
	return (
		runActivity()
			.getInstances()
			.find((activity) => activity.getId() === key) ?? null
	);
}

const staleDate = () => new Date(Date.now() + STALE_MS);

/**
 * iOS: a Live Activity per followed run, started and updated from the app
 * while it runs. Night Shift's push goes through Expo, which cannot send
 * Live Activity updates, so the activity shows "out of date" after a
 * while in the background and catches up when the app opens again.
 */
export const lockScreen: LockScreenPort = {
	available: true,
	refusedText:
		"Your phone does not let Night Shift show Live Activities. Turn them on in Settings > Night Shift, then try again.",
	allow: async () => true,
	show: async (runId, progress) => {
		const activity = runActivity().start(
			runActivityProps(progress),
			`nightshift://runs/${runId}`,
			staleDate(),
		);
		return activity.getId();
	},
	update: async (key, progress) => {
		const activity = activityOf(key);
		if (!activity) return false;
		await activity.update(runActivityProps(progress), staleDate());
		return true;
	},
	end: async (key, progress) => {
		await activityOf(key)?.end(
			{ after: new Date(Date.now() + ENDED_STAYS_MS) },
			runActivityProps(progress),
		);
	},
	remove: async (key) => {
		await activityOf(key)?.end("immediate");
	},
};
