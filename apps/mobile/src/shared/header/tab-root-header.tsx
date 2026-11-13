import { AvatarButton } from "./header-button";
import type { HeaderItem } from "./header-items";
import { HeaderToolbar } from "./header-toolbar";

/**
 * The header of a tab's first screen, the same on each tab: your avatar
 * on the left opens Settings. `right` holds items such as the Space
 * picker on Runs. A run starts from a schedule's Run now: new runs are
 * made on the computer.
 */
export function TabRootHeader({
	name,
	right = [],
}: {
	/** The person signed in, for the avatar. */
	name: string;
	right?: readonly HeaderItem[];
}) {
	return (
		<>
			<HeaderToolbar
				placement="left"
				items={[
					{
						kind: "view",
						key: "settings",
						element: (
							<AvatarButton
								name={name}
								label="Settings"
								hint={`Signed in as ${name}`}
								href="/settings"
							/>
						),
					},
				]}
			/>
			{right.length > 0 ? (
				<HeaderToolbar placement="right" items={right} />
			) : null}
		</>
	);
}
