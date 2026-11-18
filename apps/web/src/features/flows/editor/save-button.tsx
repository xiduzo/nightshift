import { Button } from "@nightshift/ui/components/button";
import { Kbd, KbdGroup } from "@nightshift/ui/components/kbd";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { CheckIcon, CircleAlertIcon, SaveIcon } from "lucide-react";

/** Undo or Redo in the header, with its keys in the tooltip. */
type SaveState = "saved" | "unsaved" | "saving" | "failed" | "blocked";

const saveLooks: Record<
	SaveState,
	{ label: string; hint: string; status: string }
> = {
	saved: { label: "Saved", hint: "All changes are saved", status: "Saved" },
	unsaved: { label: "Save", hint: "Save", status: "Unsaved changes" },
	saving: { label: "Saving…", hint: "Saving", status: "Saving" },
	failed: {
		label: "Save",
		hint: "Could not save. Try again.",
		status: "Could not save",
	},
	blocked: {
		label: "Save",
		hint: "Fix the fields marked in the issues first.",
		status: "Unsaved changes",
	},
};

/** The Save button shows whether the flow has changes that wait to be saved. */
export function SaveButton({
	state,
	onClick,
}: {
	state: SaveState;
	onClick: () => void;
}) {
	const look = saveLooks[state];
	return (
		<>
			<span aria-live="polite" className="sr-only">
				{look.status}
			</span>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="outline"
							size="sm"
							onClick={onClick}
							disabled={state !== "unsaved" && state !== "failed"}
							className={cn(
								"relative",
								state === "saved" && "text-muted-foreground",
							)}
						/>
					}
				>
					{state === "saving" ? (
						<Spinner data-icon="inline-start" />
					) : state === "saved" ? (
						<CheckIcon data-icon="inline-start" />
					) : state === "failed" ? (
						<CircleAlertIcon
							data-icon="inline-start"
							className="text-destructive"
						/>
					) : (
						<SaveIcon data-icon="inline-start" />
					)}
					{look.label}
					{(state === "unsaved" || state === "blocked") && (
						<span
							aria-hidden="true"
							className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-status-waiting"
						/>
					)}
				</TooltipTrigger>
				<TooltipContent>
					{look.hint}
					{state === "unsaved" || state === "failed" ? (
						<KbdGroup>
							<Kbd>⌘/Ctrl</Kbd>
							<Kbd>S</Kbd>
						</KbdGroup>
					) : null}
				</TooltipContent>
			</Tooltip>
		</>
	);
}
