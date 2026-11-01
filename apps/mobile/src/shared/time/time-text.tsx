import { hoverTime } from "@nightshift/client";
import { Text } from "@nightshift/ui-native/components/ui/text";
import type { ComponentProps, ReactNode } from "react";

/**
 * A moment on this phone's clock. The text is local. The accessibility
 * hint is the same moment in UTC, the schedule's clock when that zone is
 * not this phone's, and the computer when a schedule names one.
 */
export function TimeText({
	at,
	children,
	zone,
	device,
	...props
}: {
	at: number;
	children: ReactNode;
	/** The schedule's clock, when it is not this phone's. */
	zone?: string;
	/** The computer a schedule runs on. */
	device?: string | null;
} & Omit<ComponentProps<typeof Text>, "children" | "accessibilityHint">) {
	return (
		<Text {...props} accessibilityHint={hoverTime(at, { zone, device })}>
			{children}
		</Text>
	);
}
