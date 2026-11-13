import {
	Card,
	CircularProgressIndicator,
	Column,
	DropdownMenu,
	DropdownMenuItem,
	HorizontalDivider,
	Host,
	LazyColumn,
	ListItem,
	PullToRefreshBox,
	RadioButton,
	RNHostView,
	Switch,
	Text,
	TextButton,
} from "@expo/ui/jetpack-compose";
import {
	alpha,
	combinedClickable,
	fillMaxSize,
	fillMaxWidth,
	padding,
	selectable,
	semantics,
	size,
} from "@expo/ui/jetpack-compose/modifiers";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import {
	Children,
	Fragment,
	isValidElement,
	type ReactNode,
	useState,
} from "react";
import { View } from "react-native";

import { useThemeColors } from "@/shared/theme";
import type {
	NativeButtonRowProps,
	NativeCustomRowProps,
	NativeIcon,
	NativeListProps,
	NativeLoadingRowProps,
	NativeOptionRowProps,
	NativePickerRowProps,
	NativeRowProps,
	NativeSectionProps,
	NativeTextRowProps,
	NativeTitleRowProps,
	NativeToggleRowProps,
} from "./types";

/**
 * Android: the same page in Jetpack Compose, Material 3. A section is a
 * small head, then its rows as ListItems in one rounded Card split by
 * dividers (the grouped look of Android 16 Settings). Pull to refresh is
 * Material's own. Swipe actions of iOS are a long-press menu here.
 * iOS has the default file (`native-list.tsx`), with the same names.
 */

function LeadingIcon({ icon, color }: { icon: NativeIcon; color?: string }) {
	return (
		<RNHostView matchContents>
			<View>
				<Icon
					as={icon.lucide}
					size={22}
					color={color}
					className="text-muted-foreground"
				/>
			</View>
		</RNHostView>
	);
}

export function NativeList({ children, onRefresh }: NativeListProps) {
	const { scheme } = useThemeColors();
	const [refreshing, setRefreshing] = useState(false);
	const list = (
		<LazyColumn
			verticalArrangement={{ spacedBy: 20 }}
			contentPadding={{ start: 16, end: 16, top: 12, bottom: 120 }}
			modifiers={[fillMaxSize()]}
		>
			{children}
		</LazyColumn>
	);
	return (
		<Host style={{ flex: 1 }} colorScheme={scheme}>
			{onRefresh ? (
				<PullToRefreshBox
					isRefreshing={refreshing}
					onRefresh={async () => {
						setRefreshing(true);
						try {
							await onRefresh();
						} finally {
							setRefreshing(false);
						}
					}}
					modifiers={[fillMaxSize()]}
				>
					{list}
				</PullToRefreshBox>
			) : (
				list
			)}
		</Host>
	);
}

export function NativeSection({ title, footer, children }: NativeSectionProps) {
	const rows = Children.toArray(children).filter(isValidElement);
	return (
		<Column verticalArrangement={{ spacedBy: 8 }} modifiers={[fillMaxWidth()]}>
			{title ? (
				<Text
					style={{ typography: "titleSmall" }}
					modifiers={[padding(16, 0, 16, 0)]}
				>
					{title}
				</Text>
			) : null}
			<Card modifiers={[fillMaxWidth()]}>
				{rows.map((row, index) => (
					<Fragment key={row.key ?? index}>
						{index > 0 ? <HorizontalDivider /> : null}
						{row}
					</Fragment>
				))}
			</Card>
			{footer ? (
				<Text
					style={{ typography: "bodySmall" }}
					modifiers={[padding(16, 0, 16, 0), alpha(0.7)]}
				>
					{footer}
				</Text>
			) : null}
		</Column>
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
	actions,
	accessibilityLabel,
}: NativeRowProps) {
	const [menu, setMenu] = useState(false);
	const hasMenu = Boolean(actions && actions.length > 0);
	const item = (
		<ListItem
			modifiers={[
				...(accessibilityLabel
					? [semantics({ contentDescription: accessibilityLabel })]
					: []),
				...(onPress || hasMenu
					? [
							combinedClickable({
								onClick: onPress,
								onLongClick: hasMenu ? () => setMenu(true) : undefined,
							}),
						]
					: []),
				...(muted ? [alpha(0.5)] : []),
			]}
		>
			{overline ? (
				<ListItem.OverlineContent>
					<Text maxLines={1}>{overline}</Text>
				</ListItem.OverlineContent>
			) : null}
			<ListItem.HeadlineContent>
				<Text color={titleColor} maxLines={3}>
					{title}
				</Text>
			</ListItem.HeadlineContent>
			{subtitle ? (
				<ListItem.SupportingContent>
					<Text maxLines={2}>{subtitle}</Text>
				</ListItem.SupportingContent>
			) : null}
			{icon ? (
				<ListItem.LeadingContent>
					<LeadingIcon icon={icon} color={iconColor} />
				</ListItem.LeadingContent>
			) : null}
			{value ? (
				<ListItem.TrailingContent>
					<Text style={{ typography: "labelMedium" }}>{value}</Text>
				</ListItem.TrailingContent>
			) : null}
		</ListItem>
	);
	if (!hasMenu) return item;
	return (
		<DropdownMenu expanded={menu} onDismissRequest={() => setMenu(false)}>
			<DropdownMenu.Trigger>{item}</DropdownMenu.Trigger>
			<DropdownMenu.Items>
				{actions?.map((action) => (
					<DropdownMenuItem
						key={action.label}
						onClick={() => {
							setMenu(false);
							action.onPress();
						}}
						elementColors={
							action.destructive ? { textColor: "#dc2626" } : undefined
						}
					>
						<DropdownMenuItem.Text>
							<Text>{action.label}</Text>
						</DropdownMenuItem.Text>
					</DropdownMenuItem>
				))}
			</DropdownMenu.Items>
		</DropdownMenu>
	);
}

export function NativeTitleRow({
	overline,
	title,
	caption,
	captionColor,
}: NativeTitleRowProps) {
	return (
		<Column
			verticalArrangement={{ spacedBy: 6 }}
			modifiers={[padding(16, 16, 16, 16)]}
		>
			{overline ? (
				<Text style={{ typography: "labelLarge" }} modifiers={[alpha(0.7)]}>
					{overline}
				</Text>
			) : null}
			<Text style={{ typography: "headlineSmall" }}>{title}</Text>
			{caption ? (
				<Text style={{ typography: "labelLarge" }} color={captionColor}>
					{caption}
				</Text>
			) : null}
		</Column>
	);
}

export function NativeTextRow({
	text,
	secondary,
	note,
	icon,
	iconColor,
}: NativeTextRowProps) {
	return (
		<ListItem>
			<ListItem.HeadlineContent>
				<Text
					style={{ typography: "bodyLarge" }}
					modifiers={secondary ? [alpha(0.7)] : []}
				>
					{text.replace(/\*\*|__/g, "")}
				</Text>
			</ListItem.HeadlineContent>
			{note ? (
				<ListItem.SupportingContent>
					<Text>{note}</Text>
				</ListItem.SupportingContent>
			) : null}
			{icon ? (
				<ListItem.LeadingContent>
					<LeadingIcon icon={icon} color={iconColor} />
				</ListItem.LeadingContent>
			) : null}
		</ListItem>
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
		<ListItem
			modifiers={[
				selectable(selected, onPress, "radioButton"),
				...(disabled ? [alpha(0.5)] : []),
			]}
		>
			<ListItem.LeadingContent>
				<RadioButton
					selected={selected}
					enabled={!disabled}
					colors={color ? { selectedColor: color } : undefined}
				/>
			</ListItem.LeadingContent>
			{recommended ? (
				<ListItem.OverlineContent>
					<Text>Recommended</Text>
				</ListItem.OverlineContent>
			) : null}
			<ListItem.HeadlineContent>
				<Text color={color} style={{ fontWeight: "600" }}>
					{title}
				</Text>
			</ListItem.HeadlineContent>
			{subtitle ? (
				<ListItem.SupportingContent>
					<Text>{subtitle}</Text>
				</ListItem.SupportingContent>
			) : null}
		</ListItem>
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
		<ListItem
			modifiers={
				disabled
					? [alpha(0.5)]
					: [selectable(value, () => onChange(!value), "switch")]
			}
		>
			<ListItem.HeadlineContent>
				<Text>{title}</Text>
			</ListItem.HeadlineContent>
			{subtitle ? (
				<ListItem.SupportingContent>
					<Text>{subtitle}</Text>
				</ListItem.SupportingContent>
			) : null}
			<ListItem.TrailingContent>
				<Switch value={value} enabled={!disabled} onCheckedChange={onChange} />
			</ListItem.TrailingContent>
		</ListItem>
	);
}

export function NativePickerRow({
	title,
	value,
	options,
	onChange,
	disabled,
}: NativePickerRowProps) {
	const [open, setOpen] = useState(false);
	const label =
		options.find((option) => option.value === value)?.label ?? value;
	return (
		<DropdownMenu expanded={open} onDismissRequest={() => setOpen(false)}>
			<DropdownMenu.Trigger>
				<ListItem
					modifiers={
						disabled
							? [alpha(0.5)]
							: [combinedClickable({ onClick: () => setOpen(true) })]
					}
				>
					<ListItem.HeadlineContent>
						<Text>{title}</Text>
					</ListItem.HeadlineContent>
					<ListItem.SupportingContent>
						<Text>{label}</Text>
					</ListItem.SupportingContent>
				</ListItem>
			</DropdownMenu.Trigger>
			<DropdownMenu.Items>
				{options.map((option) => (
					<DropdownMenuItem
						key={option.value}
						onClick={() => {
							setOpen(false);
							onChange(option.value);
						}}
					>
						<DropdownMenuItem.Text>
							<Text
								style={{
									fontWeight: option.value === value ? "700" : "normal",
								}}
							>
								{option.label}
							</Text>
						</DropdownMenuItem.Text>
					</DropdownMenuItem>
				))}
			</DropdownMenu.Items>
		</DropdownMenu>
	);
}

export function NativeButtonRow({
	label,
	destructive,
	disabled,
	onPress,
}: NativeButtonRowProps) {
	return (
		<TextButton
			onClick={onPress}
			enabled={!disabled}
			colors={destructive ? { contentColor: "#dc2626" } : undefined}
			modifiers={[fillMaxWidth()]}
		>
			<Text>{label}</Text>
		</TextButton>
	);
}

export function NativeLoadingRow({ label }: NativeLoadingRowProps) {
	return (
		<ListItem>
			<ListItem.LeadingContent>
				<CircularProgressIndicator strokeWidth={3} modifiers={[size(24, 24)]} />
			</ListItem.LeadingContent>
			<ListItem.HeadlineContent>
				<Text modifiers={[alpha(0.7)]}>{label}</Text>
			</ListItem.HeadlineContent>
		</ListItem>
	);
}

export function NativeCustomRow({ children }: NativeCustomRowProps) {
	return (
		<RNHostView
			matchContents={{ vertical: true }}
			modifiers={[padding(16, 12, 16, 12)]}
		>
			<View>{children as ReactNode}</View>
		</RNHostView>
	);
}
