/** The rows of facts in a run's details: a label, a value, a copy button. */
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { CopyIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { formatDateTime } from "@/shared/format";
import { LocalTime } from "@/shared/time";

export function Time({
	at,
	format = formatDateTime,
}: {
	at: number;
	format?: (epochMs: number) => string;
}) {
	return (
		<LocalTime at={at} className="truncate tabular-nums">
			{format(at)}
		</LocalTime>
	);
}

/** The number of things in a section, beside its heading. */
export function Count({ n }: { n: number }) {
	return (
		<Badge variant="secondary" className="tabular-nums">
			{n}
		</Badge>
	);
}

/** One fact of the run: a small muted label above its value. */
export function Fact({
	label,
	mono,
	className,
	children,
}: {
	label: string;
	/** The label is a name from the flow, such as an input. */
	mono?: boolean;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div className={cn("flex min-w-0 flex-col gap-1", className)}>
			<dt
				className={cn(
					"truncate text-muted-foreground text-xs",
					mono && "font-mono",
				)}
			>
				{label}
			</dt>
			<dd className="flex min-h-6 min-w-0 items-center gap-1.5 text-sm">
				{children}
			</dd>
		</div>
	);
}

/** A mono value that may be cut short, with its full text in a tooltip and a copy button. */
export function CopyValue({
	label,
	value,
	short,
}: {
	label: string;
	value: string;
	/** A shorter form to show, such as the start of a hash. */
	short?: string;
}) {
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			toast.success(`Copied the ${label}.`);
		} catch {
			toast.error("Could not copy.");
		}
	};
	return (
		<>
			<Tooltip>
				<TooltipTrigger
					render={<span className="min-w-0 truncate font-mono text-xs" />}
				>
					{short ?? value}
				</TooltipTrigger>
				<TooltipContent className="max-w-md break-all font-mono">
					{value}
				</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon-xs"
							className="text-muted-foreground"
							aria-label={`Copy the ${label}`}
							onClick={copy}
						/>
					}
				>
					<CopyIcon aria-hidden="true" />
				</TooltipTrigger>
				<TooltipContent>Copy</TooltipContent>
			</Tooltip>
		</>
	);
}
