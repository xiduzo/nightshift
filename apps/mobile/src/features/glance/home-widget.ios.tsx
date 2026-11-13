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
 * The home screen and lock screen widget on iOS: what needs you now. The
 * Gates marked Now and the flows that need a look, each with its flow and
 * why. A tap opens Needs you.
 *
 * A `'widget'` function runs in the widget's own runtime: it may use only
 * its props, its environment and `@expo/ui` components, nothing else from
 * this file. Its name must match `widgets[].name` in app.json.
 */
const layout = (props: HomeWidgetProps, environment: WidgetEnvironment) => {
	"widget";
	const dark = environment.colorScheme === "dark";
	const items = props.items ?? [];
	const count = props.now ?? 0;
	const label =
		count === 0
			? props.nowText
			: count === 1
				? "thing needs you now"
				: "things need you now";

	if (environment.widgetFamily === "accessoryInline") {
		return (
			<Text modifiers={[widgetURL("nightshift://")]}>{props.nowText}</Text>
		);
	}

	if (environment.widgetFamily === "accessoryRectangular") {
		const first = items[0];
		return (
			<VStack
				alignment="leading"
				spacing={2}
				modifiers={[widgetURL("nightshift://")]}
			>
				<Text modifiers={[font({ weight: "semibold", size: 15 })]}>
					{props.nowText}
				</Text>
				{first ? (
					<Text modifiers={[font({ size: 13 }), lineLimit(1)]}>
						{`${first.flow} · ${first.detail}`}
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
					widgetURL("nightshift://"),
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
				widgetURL("nightshift://"),
			]}
		>
			{waiting}
			<VStack alignment="leading" spacing={8} modifiers={[padding({ top: 2 })]}>
				{items.length === 0 ? (
					<Text
						modifiers={[
							font({ size: 13 }),
							foregroundStyle({ type: "hierarchical", style: "secondary" }),
						]}
					>
						{props.laterText}
					</Text>
				) : (
					items.map((item) => (
						<HStack key={item.id} spacing={6} alignment="top">
							<Image
								systemName="circle.fill"
								size={8}
								color={dark ? item.dark : item.light}
								modifiers={[padding({ top: 4 })]}
							/>
							<VStack alignment="leading" spacing={0}>
								<Text
									modifiers={[
										font({ size: 13, weight: "medium" }),
										lineLimit(1),
									]}
								>
									{item.flow}
								</Text>
								<Text
									modifiers={[
										font({ size: 12 }),
										foregroundStyle(dark ? item.dark : item.light),
										lineLimit(1),
									]}
								>
									{item.detail}
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
