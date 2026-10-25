import { hasEnded, runActions, useRunActed, whyNot } from "@nightshift/client";
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
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRightLeftIcon, MonitorIcon } from "lucide-react";
import { toast } from "sonner";

import type { RunDetail, RunStatus } from "@/shared/api";
import { orpc } from "@/shared/api";
import { runMutations, runQueries } from "../queries";

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
	const runActed = useRunActed({ orpc });
	// Your own devices that are online, from the run's own Space.
	const moveTargets = useQuery({
		...runQueries.moveTargets(run.id),
		meta: { quietErrors: true },
	});
	const targets = moveTargets.data ?? [];
	const move = useMutation(
		runMutations.move({
			onSuccess: (_, input) => {
				const to = targets.find((d) => d.deviceId === input.deviceId);
				toast.success(`${to?.name ?? "The device"} goes on with the run.`);
				runActed(input.runId);
			},
			onError: (error) => toast.error(`Could not move: ${error.message}`),
		}),
	);
	const walkedHere = run.walker.thisDevice;
	const movable = runActions(status, walkedHere).move;
	// A run that ended for good has nothing to move.
	if (targets.length === 0 || (!movable && hasEnded(status))) return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="outline"
						size="sm"
						disabled={!movable || move.isPending}
						title={whyNot("move", status, walkedHere) ?? undefined}
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
