import {
	Button,
	Host,
	HStack,
	Image,
	List,
	Picker,
	RNHostView,
	Section,
	Spacer,
	SwipeActions,
	Text,
	Toggle,
	VStack,
} from "@expo/ui/swift-ui";
import {
	accessibilityElement,
	accessibilityLabel as accessibilityLabelModifier,
	disabled as disabledModifier,
	font,
	foregroundStyle,
	labelsHidden,
	lineLimit,
	listStyle,
	opacity,
	pickerStyle,
	refreshable,
	tag,
	textSelection,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";

import { useThemeColors } from "@/shared/theme";
import type {
	NativeButtonRowProps,
	NativeCustomRowProps,
	NativeListProps,
	NativeOptionRowProps,
	NativePickerRowProps,
	NativeRowProps,
	NativeSectionProps,
	NativeTextRowProps,
	NativeTitleRowProps,
	NativeToggleRowProps,
	RowAction,
} from "./types";

/**
 * iOS: the page is a SwiftUI List in the inset grouped style, the look of
 * the Settings app. The system draws the rows, the section heads and
 * footers, the swipe actions, pull to refresh and Dynamic Type. Android
 * has its own file (`native-list.android.tsx`), with the same names.
 */

const SECONDARY = foregroundStyle({
	type: "hierarchical",
	style: "secondary",
} as never);
const RED = "#dc2626";

export function NativeList({ children, onRefresh }: NativeListProps) {
	const { scheme } = useThemeColors();
	return (
		<Host style={{ flex: 1 }} colorScheme={scheme}>
			<List
				modifiers={[
					listStyle("insetGrouped"),
					...(onRefresh
						? [
								refreshable(async () => {
									await onRefresh();
								}),
							]
						: []),
				]}
			>
				{children}
			</List>
		</Host>
	);
}

export function NativeSection({ title, footer, children }: NativeSectionProps) {
	return (
		<Section title={title} footer={footer ? <Text>{footer}</Text> : undefined}>
			{children}
		</Section>
	);
}

function withActions(
	row: ReactNode,
	actions: readonly RowAction[] | undefined,
) {
	if (!actions || actions.length === 0) return row;
	const leading = actions.filter((action) => action.edge === "leading");
	const trailing = actions.filter((action) => action.edge !== "leading");
	const button = (action: RowAction) => (
		<Button
			key={action.label}
			systemImage={action.icon.sf}
			label={action.label}
			onPress={action.onPress}
			modifiers={[tint(action.destructive ? RED : (action.color ?? "#6b7280"))]}
		/>
	);
	return (
		<SwipeActions>
			{row}
			{trailing.length > 0 ? (
				<SwipeActions.Actions edge="trailing">
					{trailing.map(button)}
				</SwipeActions.Actions>
			) : null}
			{leading.length > 0 ? (
				<SwipeActions.Actions edge="leading">
					{leading.map(button)}
				</SwipeActions.Actions>
			) : null}
		</SwipeActions>
	);
}

export function NativeRow({
	title,
	overline,
	subtitle,
	value,
	icon,
	iconColor,
	titleColor,
	muted,
	onPress,
	chevron,
	actions,
	accessibilityLabel: label,
}: NativeRowProps) {
	const content = (
		<HStack
			spacing={12}
			modifiers={[
				...(muted ? [opacity(0.5)] : []),
				// One element for VoiceOver, in the words the screen gives.
				...(label
					? [accessibilityElement("combine"), accessibilityLabelModifier(label)]
					: []),
			]}
		>
			{icon ? <Image systemName={icon.sf} color={iconColor} size={20} /> : null}
			<VStack alignment="leading" spacing={2}>
				{overline ? (
					<Text
						modifiers={[
							font({ textStyle: "caption" }),
							SECONDARY,
							lineLimit(1),
						]}
					>
						{overline}
					</Text>
				) : null}
				<Text
					modifiers={[
						font({ textStyle: "body" }),
						lineLimit(3),
						...(titleColor ? [foregroundStyle(titleColor)] : []),
					]}
				>
					{title}
				</Text>
				{subtitle ? (
					<Text
						modifiers={[
							font({ textStyle: "footnote" }),
							SECONDARY,
							lineLimit(2),
						]}
					>
						{subtitle}
					</Text>
				) : null}
			</VStack>
			<Spacer />
			{value ? (
				<Text modifiers={[font({ textStyle: "subheadline" }), SECONDARY]}>
					{value}
				</Text>
			) : null}
			{onPress && chevron !== false ? (
				<Image systemName="chevron.right" size={13} color="#9ca3af" />
			) : null}
		</HStack>
	);
	const row = onPress ? (
		<Button onPress={onPress} modifiers={[tint("primary" as never)]}>
			{content}
		</Button>
	) : (
		content
	);
	return withActions(row, actions);
}

export function NativeTitleRow({
	overline,
	title,
	caption,
	captionColor,
}: NativeTitleRowProps) {
	return (
		<VStack alignment="leading" spacing={6}>
			{overline ? (
				<Text modifiers={[font({ textStyle: "subheadline" }), SECONDARY]}>
					{overline}
				</Text>
			) : null}
			<Text modifiers={[font({ textStyle: "title2", weight: "bold" })]}>
				{title}
			</Text>
			{caption ? (
				<Text
					modifiers={[
						font({ textStyle: "subheadline", weight: "medium" }),
						captionColor ? foregroundStyle(captionColor) : SECONDARY,
					]}
				>
					{caption}
				</Text>
			) : null}
		</VStack>
	);
}

export function NativeTextRow({
	text,
	secondary,
	note,
	icon,
	iconColor,
	selectable,
}: NativeTextRowProps) {
	const body = (
		<VStack alignment="leading" spacing={4}>
			<Text
				markdownEnabled
				modifiers={[
					...(secondary ? [SECONDARY] : []),
					...(selectable ? [textSelection(true)] : []),
				]}
			>
				{text}
			</Text>
			{note ? (
				<Text modifiers={[font({ textStyle: "caption" }), SECONDARY]}>
					{note}
				</Text>
			) : null}
		</VStack>
	);
	if (!icon) return body;
	return (
		<HStack spacing={12} alignment="top">
			<Image systemName={icon.sf} color={iconColor} size={18} />
			{body}
			<Spacer />
		</HStack>
	);
}

export function NativeOptionRow({
	title,
	subtitle,
	color,
	selected,
	recommended,
	disabled,
	onPress,
}: NativeOptionRowProps) {
	return (
		<Button
			onPress={onPress}
			modifiers={[tint("primary" as never), disabledModifier(disabled)]}
		>
			<HStack spacing={12} alignment="top">
				<Image
					systemName={selected ? "checkmark.circle.fill" : "circle"}
					color={selected ? color : "#9ca3af"}
					size={22}
				/>
				<VStack alignment="leading" spacing={2}>
					<HStack spacing={6}>
						<Text
							modifiers={[
								font({ textStyle: "body", weight: "semibold" }),
								...(color ? [foregroundStyle(color)] : []),
							]}
						>
							{title}
						</Text>
						{recommended ? (
							<Text
								modifiers={[
									font({ textStyle: "caption2", weight: "semibold" }),
									SECONDARY,
								]}
							>
								RECOMMENDED
							</Text>
						) : null}
					</HStack>
					{subtitle ? (
						<Text modifiers={[font({ textStyle: "footnote" }), SECONDARY]}>
							{subtitle}
						</Text>
					) : null}
				</VStack>
				<Spacer />
			</HStack>
		</Button>
	);
}

export function NativeToggleRow({
	title,
	subtitle,
	value,
	onChange,
	disabled,
}: NativeToggleRowProps) {
	return (
		<Toggle
			isOn={value}
			onIsOnChange={onChange}
			modifiers={[disabledModifier(disabled)]}
		>
			<VStack alignment="leading" spacing={2}>
				<Text>{title}</Text>
				{subtitle ? (
					<Text modifiers={[font({ textStyle: "footnote" }), SECONDARY]}>
						{subtitle}
					</Text>
				) : null}
			</VStack>
		</Toggle>
	);
}

export function NativePickerRow({
	title,
	value,
	options,
	onChange,
	disabled,
}: NativePickerRowProps) {
	return (
		<Picker
			label={title}
			selection={value}
			onSelectionChange={(next) => onChange(String(next))}
			modifiers={[pickerStyle("menu"), disabledModifier(disabled)]}
		>
			{options.map((option) => (
				<Text key={option.value} modifiers={[tag(option.value)]}>
					{option.label}
				</Text>
			))}
		</Picker>
	);
}

export function NativeButtonRow({
	label,
	icon,
	destructive,
	disabled,
	onPress,
}: NativeButtonRowProps) {
	return (
		<Button
			label={label}
			systemImage={icon?.sf}
			role={destructive ? "destructive" : undefined}
			onPress={onPress}
			modifiers={[disabledModifier(disabled)]}
		/>
	);
}

export function NativeCustomRow({ children }: NativeCustomRowProps) {
	return (
		<RNHostView matchContents={{ vertical: true }}>
			<>{children}</>
		</RNHostView>
	);
}

/** Keeps a label off screen for pickers that sit in a row of their own. */
export const HIDE_LABELS = labelsHidden;
