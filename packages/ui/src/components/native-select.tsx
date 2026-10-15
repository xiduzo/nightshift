import { cn } from "@nightshift/ui/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import type * as React from "react";

function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
	return (
		<div
			data-slot="native-select-wrapper"
			className="group/native-select relative w-full has-[select:disabled]:opacity-50"
		>
			<select
				data-slot="native-select"
				className={cn(
					"h-8 w-full min-w-0 appearance-none rounded-none border border-input bg-transparent py-1 pr-8 pl-2.5 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
					className,
				)}
				{...props}
			/>
			<ChevronDownIcon
				aria-hidden="true"
				className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 select-none text-muted-foreground"
			/>
		</div>
	);
}

function NativeSelectOption({
	className,
	...props
}: React.ComponentProps<"option">) {
	return (
		<option
			data-slot="native-select-option"
			className={cn("bg-popover text-popover-foreground", className)}
			{...props}
		/>
	);
}

export { NativeSelect, NativeSelectOption };
