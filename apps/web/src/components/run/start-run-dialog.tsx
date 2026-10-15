import { Button } from "@nightshift/ui/components/button";
import { Checkbox } from "@nightshift/ui/components/checkbox";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import { Input } from "@nightshift/ui/components/input";
import { Label } from "@nightshift/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PlayIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useNow } from "@/hooks/use-now";
import {
	dayWord,
	formatDayTime,
	formatWaited,
	nextOccurrence,
} from "@/lib/format";
import { orpc } from "@/utils/orpc";

const STORAGE_KEY = "nightshift:stop-time";
const DEFAULT_TIME = "07:00";

type StoredStop = { on: boolean; time: string };

/** The stop time of the last start. Storage can be missing or blocked. */
function readStoredStop(): StoredStop {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<StoredStop>;
			if (typeof parsed.time === "string" && typeof parsed.on === "boolean") {
				return { on: parsed.on, time: parsed.time };
			}
		}
	} catch {
		// Fall through to the default.
	}
	return { on: false, time: DEFAULT_TIME };
}

function writeStoredStop(stop: StoredStop) {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stop));
	} catch {
		// Not remembered; the dialog still works.
	}
}

/** Starts a flow file in a new worktree, with an optional stop time. */
export function StartRunDialog({
	open,
	onOpenChange,
	projectId,
	flowName,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	flowName: string;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				{open ? (
					<StartRunForm
						projectId={projectId}
						flowName={flowName}
						onStarted={() => onOpenChange(false)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function StartRunForm({
	projectId,
	flowName,
	onStarted,
}: {
	projectId: string;
	flowName: string;
	onStarted: () => void;
}) {
	const id = useId();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [stop, setStop] = useState(readStoredStop);
	const now = useNow(15_000);

	const stopAt = stop.on ? nextOccurrence(stop.time, now) : null;
	const invalid = stop.on && stopAt === null;

	const startRun = useMutation(
		orpc.runs.start.mutationOptions({
			onSuccess: (run) => {
				onStarted();
				void queryClient.invalidateQueries({ queryKey: orpc.runs.key() });
				void navigate({ to: "/runs/$runId", params: { runId: run.id } });
			},
			onError: (error) => toast.error(`Could not start: ${error.message}`),
		}),
	);

	const start = () => {
		if (invalid || startRun.isPending) return;
		writeStoredStop(stop);
		// Computed at the click, so a dialog left open does not start with a stale time.
		const at = stop.on ? nextOccurrence(stop.time) : null;
		startRun.mutate({
			projectId,
			flowName,
			...(at === null ? {} : { stopAt: at }),
		});
	};

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				start();
			}}
		>
			<DialogHeader>
				<DialogTitle>
					Run <span className="font-mono">{flowName}</span>
				</DialogTitle>
				<DialogDescription>
					The run works in a new worktree on its own branch. You can stop it at
					any time.
				</DialogDescription>
			</DialogHeader>

			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<Checkbox
						id={`${id}-on`}
						checked={stop.on}
						onCheckedChange={(on) => setStop((current) => ({ ...current, on }))}
					/>
					<Label htmlFor={`${id}-on`}>Stop at a time</Label>
					<Input
						id={`${id}-time`}
						type="time"
						value={stop.time}
						disabled={!stop.on}
						aria-label="Stop time"
						aria-invalid={invalid}
						aria-describedby={`${id}-hint`}
						className="ml-auto h-7 w-28 font-mono tabular-nums"
						onChange={(event) =>
							setStop({ on: true, time: event.target.value })
						}
					/>
				</div>
				<p
					id={`${id}-hint`}
					aria-live="polite"
					className={
						invalid
							? "text-destructive text-xs"
							: "text-muted-foreground text-xs"
					}
				>
					{!stop.on ? (
						"No stop time: the run goes until its flow ends."
					) : stopAt === null ? (
						"Enter a time, for example 07:00."
					) : (
						<>
							Stops{" "}
							<time
								dateTime={new Date(stopAt).toISOString()}
								className="font-medium text-foreground"
							>
								{dayWord(stopAt, now)}, {formatDayTime(stopAt)}
							</time>{" "}
							(in {formatWaited(stopAt - now)}). No new step starts after it;
							the run then ends as stopped.
						</>
					)}
				</p>
			</div>

			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={invalid || startRun.isPending}>
					<PlayIcon data-icon="inline-start" />
					{startRun.isPending ? "Starting…" : "Start"}
				</Button>
			</DialogFooter>
		</form>
	);
}
