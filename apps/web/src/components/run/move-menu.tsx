import { Button } from "@nightshift/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeftIcon, MonitorIcon } from "lucide-react";
import { toast } from "sonner";

import type { RunDetail, RunStatus } from "@/lib/api-types";
import { orpc } from "@/utils/orpc";

/** A run in the middle of a step does not move; one that ended has nothing to move. */
const MOVABLE: readonly RunStatus[] = [
	"waiting",
	"sleeping",
	"stopped",
	"failed",
	"interrupted",
];

/**
 * "Move to…": another of your devices walks the run from here on. Its
 * steps still run where they are placed. Shown when you have another
 * device online, for a run that waits, sleeps or has stopped.
 */
export function MoveMenu({
	run,
	status,
}: {
	run: RunDetail;
	status: RunStatus;
}) {
	const queryClient = useQueryClient();
	const devices = useQuery({
		...orpc.runs.devices.queryOptions({ input: { projectId: run.projectId } }),
		meta: { quietErrors: true },
	});
	// Your own devices only: another person's device offers steps, not walks.
	const targets = (devices.data ?? []).filter(
		(d) => d.online && d.deviceId !== run.walker.id && d.offers === undefined,
	);
	const move = useMutation(
		orpc.runs.move.mutationOptions({
			onSuccess: (_, input) => {
				const to = targets.find((d) => d.deviceId === input.deviceId);
				toast.success(`${to?.name ?? "The device"} goes on with the run.`);
				void queryClient.invalidateQueries({ queryKey: orpc.runs.key() });
			},
			onError: (error) => toast.error(`Could not move: ${error.message}`),
		}),
	);
	if (targets.length === 0 || status === "finished") return null;
	const movable = MOVABLE.includes(status);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="outline"
						size="sm"
						disabled={!movable || move.isPending}
						title={
							movable
								? undefined
								: "Move the run when it waits, sleeps or has stopped."
						}
					/>
				}
			>
				{move.isPending ? (
					<Spinner data-icon="inline-start" />
				) : (
					<ArrowRightLeftIcon data-icon="inline-start" />
				)}
				<span className="hidden sm:inline">Move to…</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				<DropdownMenuGroup>
					<DropdownMenuLabel>Go on with the run on</DropdownMenuLabel>
					{targets.map((d) => (
						<DropdownMenuItem
							key={d.deviceId}
							onClick={() =>
								move.mutate({ runId: run.id, deviceId: d.deviceId })
							}
						>
							<MonitorIcon />
							{d.thisDevice ? `${d.name} (this computer)` : d.name}
						</DropdownMenuItem>
					))}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
