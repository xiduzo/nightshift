import { Stack } from "expo-router";

import type { RunHeaderProps } from "./run-header-types";

const DESTRUCTIVE = "#dc2626";

/**
 * iOS: the run's main action is a system button on the right of the
 * header (Stop in red), next to a ⋯ menu with the rarer actions. The run
 * is pushed over the tabs, so the bottom toolbar holds its other views.
 * Android has its own file (`run-header.android.tsx`).
 */
export function RunHeader({ primary, menu, views }: RunHeaderProps) {
	return (
		<>
			<Stack.Toolbar placement="right">
				{primary ? (
					<Stack.Toolbar.Button
						tintColor={primary.destructive ? DESTRUCTIVE : undefined}
						disabled={primary.disabled}
						onPress={primary.onPress}
						accessibilityHint={primary.subtitle}
					>
						{primary.label}
					</Stack.Toolbar.Button>
				) : null}
				{menu.length > 0 ? (
					<Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More actions">
						{menu.map((item) => (
							<Stack.Toolbar.MenuAction
								key={item.key}
								icon={item.icon.sf}
								destructive={item.destructive}
								disabled={item.disabled}
								subtitle={item.subtitle}
								onPress={item.onPress}
							>
								{item.label}
							</Stack.Toolbar.MenuAction>
						))}
					</Stack.Toolbar.Menu>
				) : null}
			</Stack.Toolbar>
			{views.length > 0 ? (
				<Stack.Toolbar>
					{/* The toolbar reads its items as direct children: no Fragments. */}
					{views.flatMap((item, index) => [
						...(index > 0
							? [<Stack.Toolbar.Spacer key={`${item.key}-gap`} />]
							: []),
						<Stack.Toolbar.Button
							key={item.key}
							icon={item.icon.sf}
							disabled={item.disabled}
							accessibilityLabel={item.label}
							accessibilityHint={item.subtitle}
							onPress={item.onPress}
						/>,
					])}
				</Stack.Toolbar>
			) : null}
		</>
	);
}
