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
	frame,
	lineLimit,
	monospacedDigit,
	multilineTextAlignment,
	padding,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { asDate, now } from "@nightshift/client";
import {
	createLiveActivity,
	type LiveActivity,
	type LiveActivityEnvironment,
	type LiveActivityFactory,
} from "expo-widgets";
import type { ComponentProps } from "react";
import { type RunActivityProps, runActivityProps } from "./glance-props";
import type { LockScreenPort } from "./lock-screen-port";

/** After this long without an update, iOS shows the activity as out of date. */
const STALE_MS = 10 * 60_000;
/** How long an ended run stays on the lock screen. */
const ENDED_STAYS_MS = 30 * 60_000;

/** An SF Symbol name, as `Image` takes it. The props carry it as a plain string. */
type SymbolName = NonNullable<ComponentProps<typeof Image>["systemName"]>;

/** A week: the far end of the timer that counts a run's time at work. */
const WEEK_MS = 7 * 24 * 60 * 60_000;

/**
 * A followed run as a Live Activity, in the app's own words and colors.
 * The lock screen shows the status with its symbol ("Needs you · Answer
 * by 07:30", "Running · Step 2 of 4"), the flow, the step and a progress
 * bar. A clock counts by itself, also while the app sleeps: down to the
 * moment a Gate chooses for you, or up for the time the run is at work
 * (it stops when the run ends). The Dynamic Island shows the status
 * symbol, and "2/4", the time left at a Gate, or the end word. A
 * `'widget'` function runs in the widget's own runtime: it may use only
 * its props, its environment and `@expo/ui` components.
 */
const layout = (
	props: RunActivityProps,
	environment: LiveActivityEnvironment,
) => {
	"widget";
	const color = environment.colorScheme === "dark" ? props.dark : props.light;
	const stale = environment.isStale && !props.ended;
	const counting = props.deadlineAt > 0 && !props.ended;
	const muted = foregroundStyle({ type: "hierarchical", style: "secondary" });
	const clock = (size: number, width: number) =>
		counting ? (
			<Text
				timerInterval={{
					lower: new Date(props.startedAt),
					upper: new Date(props.deadlineAt),
				}}
				countsDown
				modifiers={[
					font({ size, weight: "semibold" }),
					monospacedDigit(),
					multilineTextAlignment("trailing"),
					foregroundStyle(color),
					frame({ width }),
				]}
			/>
		) : (
			<Text
				timerInterval={{
					lower: new Date(props.startedAt),
					upper: new Date(props.startedAt + WEEK_MS),
				}}
				countsDown={false}
				pauseTime={props.endedAt > 0 ? new Date(props.endedAt) : undefined}
				modifiers={[
					font({ size, weight: "medium" }),
					monospacedDigit(),
					multilineTextAlignment("trailing"),
					muted,
					frame({ width }),
				]}
			/>
		);
	const status = (
		<HStack spacing={6}>
			<Image systemName={props.symbol as SymbolName} color={color} size={15} />
			<Text
				modifiers={[
					font({ weight: "semibold", size: 15 }),
					foregroundStyle(color),
					lineLimit(1),
				]}
			>
				{stale ? props.statusText : props.headline}
			</Text>
		</HStack>
	);
	const body = (
		<VStack alignment="leading" spacing={4}>
			<Text modifiers={[font({ weight: "semibold", size: 17 }), lineLimit(1)]}>
				{props.flow}
			</Text>
			{stale ? (
				<Text modifiers={[font({ size: 15 }), muted, lineLimit(1)]}>
					{props.staleText}
				</Text>
			) : props.step ? (
				<Text modifiers={[font({ size: 15 }), muted, lineLimit(1)]}>
					{props.step}
				</Text>
			) : null}
		</VStack>
	);
	const symbol = (
		<Image systemName={props.symbol as SymbolName} color={color} size={16} />
	);
	return {
		banner: (
			<VStack
				alignment="leading"
				spacing={8}
				modifiers={[padding({ all: 16 })]}
			>
				<HStack spacing={8}>
					{status}
					<Spacer />
					{clock(15, 72)}
				</HStack>
				{body}
				<ProgressView value={props.fraction} modifiers={[tint(color)]} />
			</VStack>
		),
		compactLeading: symbol,
		compactTrailing: counting ? (
			clock(13, 44)
		) : (
			<Text
				modifiers={[
					font({ size: 13, weight: "semibold" }),
					monospacedDigit(),
					foregroundStyle(color),
				]}
			>
				{props.short || props.statusText}
			</Text>
		),
		minimal: symbol,
		expandedLeading: (
			<HStack spacing={6} modifiers={[padding({ leading: 8, top: 8 })]}>
				{symbol}
				<Text
					modifiers={[
						font({ weight: "semibold", size: 15 }),
						foregroundStyle(color),
						lineLimit(1),
					]}
				>
					{props.statusText}
				</Text>
			</HStack>
		),
		expandedTrailing: (
			<VStack
				alignment="trailing"
				modifiers={[padding({ trailing: 8, top: 8 })]}
			>
				{clock(15, 72)}
			</VStack>
		),
		expandedBottom: (
			<VStack
				alignment="leading"
				spacing={8}
				modifiers={[padding({ horizontal: 8, bottom: 8 })]}
			>
				{body}
				<ProgressView value={props.fraction} modifiers={[tint(color)]} />
				<Text modifiers={[font({ size: 13 }), muted, lineLimit(1)]}>
					{props.deadlineAt > 0 && !props.ended
						? props.headline
						: props.position}
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

const staleDate = () => asDate(now() + STALE_MS);

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
			{ after: asDate(now() + ENDED_STAYS_MS) },
			runActivityProps(progress),
		);
	},
	remove: async (key) => {
		await activityOf(key)?.end("immediate");
	},
};
