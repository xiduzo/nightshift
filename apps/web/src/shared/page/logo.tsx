import { cn } from "@nightshift/ui/lib/utils";
import type { ComponentProps } from "react";

import { moonIcon, useMoonPhase } from "@/shared/moon";

/**
 * The Night Shift mark: the moon in its phase of tonight, from 🌑 to 🌘.
 * The phases are OpenMoji (https://openmoji.org), CC BY-SA 4.0.
 */
export function Logo({ className, ...props }: ComponentProps<"img">) {
	const phase = useMoonPhase();

	return (
		<img
			src={moonIcon(phase)}
			alt=""
			aria-hidden="true"
			draggable={false}
			className={cn("size-8 shrink-0", className)}
			{...props}
		/>
	);
}
