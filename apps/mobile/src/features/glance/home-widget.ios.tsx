import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
	font,
	foregroundStyle,
	frame,
	lineLimit,
	padding,
	widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import {
	createWidget,
	type Widget,
	type WidgetEnvironment,
} from "expo-widgets";

import type { HomeWidgetProps } from "./glance-props";

/**
 * The home screen and lock screen widget on iOS: how many Gates wait for
 * you and the latest runs with their status. A tap opens the inbox.
 *
 * A `'widget'` function runs in the widget's own runtime: it may use only
 * its props, its environment and `@expo/ui` components, nothing else from
 * this file. Its name must match `widgets[].name` in app.json.
 */
const layout = (props: HomeWidgetProps, environment: WidgetEnvironment) => {
	"widget";
	const dark = environment.colorScheme === "dark";
	const runs = props.runs ?? [];
	const count = props.waiting ?? 0;
	const label =
		count === 0
			? props.waitingText
			: count === 1
				? "Gate waits for you"
				: "Gates wait for you";

	if (environment.widgetFamily === "accessoryInline") {
		return (
			<Text modifiers={[widgetURL("nightshift://inbox")]}>
				{props.waitingText}
			</Text>
		);
	}

	if (environment.widgetFamily === "accessoryRectangular") {
		const latest = runs[0];
		return (
			<VStack
				alignment="leading"
				spacing={2}
				modifiers={[widgetURL("nightshift://inbox")]}
			>
				<Text modifiers={[font({ weight: "semibold", size: 15 })]}>
					{props.waitingText}
				</Text>
				{latest ? (
					<Text modifiers={[font({ size: 13 }), lineLimit(1)]}>
						{`${latest.flow} · ${latest.statusText}`}
					</Text>
				) : null}
			</VStack>
		);
	}

	const waiting = (
		<VStack alignment="leading" spacing={2}>
			<Text
				modifiers={[
					font({ size: 13, weight: "medium" }),
					foregroundStyle({ type: "hierarchical", style: "secondary" }),
				]}
			>
				Night Shift
			</Text>
			<Spacer />
			{count > 0 ? (
				<Text
					modifiers={[font({ size: 40, weight: "bold", design: "rounded" })]}
				>
					{String(count)}
				</Text>
			) : null}
			<Text modifiers={[font({ size: 13, weight: "semibold" }), lineLimit(2)]}>
				{label}
			</Text>
		</VStack>
	);

	if (environment.widgetFamily !== "systemMedium") {
		return (
			<VStack
				alignment="leading"
				modifiers={[
					frame({ maxWidth: 10000, maxHeight: 10000, alignment: "topLeading" }),
					widgetURL("nightshift://inbox"),
				]}
			>
				{waiting}
			</VStack>
		);
	}

	return (
		<HStack
			alignment="top"
			spacing={16}
			modifiers={[
				frame({ maxWidth: 10000, maxHeight: 10000, alignment: "topLeading" }),
				widgetURL("nightshift://inbox"),
			]}
		>
			{waiting}
			<VStack alignment="leading" spacing={8} modifiers={[padding({ top: 2 })]}>
				{runs.length === 0 ? (
					<Text
						modifiers={[
							font({ size: 13 }),
							foregroundStyle({ type: "hierarchical", style: "secondary" }),
						]}
					>
						{props.noRunsText}
					</Text>
				) : (
					runs.map((run) => (
						<HStack key={run.id} spacing={6} alignment="top">
							<Image
								systemName="circle.fill"
								size={8}
								color={dark ? run.dark : run.light}
								modifiers={[padding({ top: 4 })]}
							/>
							<VStack alignment="leading" spacing={0}>
								<Text
									modifiers={[
										font({ size: 13, weight: "medium" }),
										lineLimit(1),
									]}
								>
									{run.flow}
								</Text>
								<Text
									modifiers={[
										font({ size: 12 }),
										foregroundStyle(dark ? run.dark : run.light),
										lineLimit(1),
									]}
								>
									{run.statusText}
								</Text>
							</VStack>
						</HStack>
					))
				)}
				<Spacer />
			</VStack>
		</HStack>
	);
};

let glance: Widget<HomeWidgetProps> | null = null;

/**
 * Shows new props on the widget now. The widget is made on the first
 * call: a build without the widget's native code throws here, not when
 * the app starts.
 */
export function showOnHomeScreen(props: HomeWidgetProps): void {
	glance ??= createWidget("NightShiftGlance", layout);
	glance.updateSnapshot(props);
}
