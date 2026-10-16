import { cn } from "@nightshift/ui/lib/utils";
import { type ComponentProps, useId } from "react";

/**
 * The Night Shift mark, "Phase shift": a solid crescent cut by an outlined
 * disc, the run moving across the night. Drawn on a 64-unit grid in
 * `currentColor`, with the outline in the running status hue.
 */
export function Logo({ className, ...props }: ComponentProps<"svg">) {
	const mask = useId();

	return (
		<svg
			viewBox="0 0 64 64"
			aria-hidden="true"
			focusable="false"
			className={cn("size-8 shrink-0", className)}
			{...props}
		>
			<mask id={mask}>
				<rect width="64" height="64" fill="#fff" />
				<circle cx="42" cy="24" r="19" fill="#000" />
			</mask>
			<circle
				cx="30"
				cy="32"
				r="22"
				fill="currentColor"
				mask={`url(#${mask})`}
			/>
			<circle
				cx="42"
				cy="24"
				r="19"
				fill="none"
				strokeWidth="2.5"
				className="stroke-status-running"
			/>
		</svg>
	);
}
