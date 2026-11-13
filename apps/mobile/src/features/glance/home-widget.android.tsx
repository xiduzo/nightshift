import { Column, Row, Spacer, Text } from "@expo/ui/jetpack-compose";
import {
	fillMaxSize,
	height,
	paddingAll,
} from "@expo/ui/jetpack-compose/modifiers";
import {
	createWidget,
	type Widget,
	type WidgetEnvironment,
} from "expo-widgets";

import type { HomeWidgetProps } from "./glance-props";

/**
 * The home screen widget on Android: what needs you now. The Gates marked
 * Now and the flows that need a look, each with its flow and why. expo-widgets 58 cannot open a link from
 * an Android widget, so a tap does not open the inbox there yet.
 *
 * A `'widget'` function runs in the widget's own runtime: it may use only
 * its props, its environment and `@expo/ui` components, nothing else from
 * this file. Its name must match `widgets[].name` in app.json.
 */
const layout = (props: HomeWidgetProps, environment: WidgetEnvironment) => {
	"widget";
	const dark = environment.colorScheme === "dark";
	const items = props.items ?? [];
	const text = dark ? props.ink?.text.dark : props.ink?.text.light;
	const muted = dark ? props.ink?.muted.dark : props.ink?.muted.light;
	return (
		<Column modifiers={[fillMaxSize(), paddingAll(12)]}>
			<Text color={muted} style={{ fontSize: 12, fontWeight: "500" }}>
				Night Shift
			</Text>
			<Text color={text} style={{ fontSize: 16, fontWeight: "700" }}>
				{props.nowText}
			</Text>
			<Spacer modifiers={[height(8)]} />
			{items.length === 0 ? (
				<Text color={muted} style={{ fontSize: 13 }}>
					{props.laterText}
				</Text>
			) : (
				items.map((item) => (
					<Row key={item.id}>
						<Text
							color={text}
							maxLines={1}
							style={{ fontSize: 13, fontWeight: "500" }}
						>
							{`${item.flow}  `}
						</Text>
						<Text
							color={dark ? item.dark : item.light}
							maxLines={1}
							style={{ fontSize: 13 }}
						>
							{item.detail}
						</Text>
					</Row>
				))
			)}
		</Column>
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
