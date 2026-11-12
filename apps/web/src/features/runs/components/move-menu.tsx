import { type RunNow, useRunActed } from "@nightshift/client";
import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRightLeftIcon, MonitorIcon } from "lucide-react";
import { toast } from "sonner";

import type { RunDetail } from "@/shared/api";
import { orpc } from "@/shared/api";
import { runMutations, runQueries } from "../queries";
import { ActionText } from "./action-text";

/**
 * "Move to…": another of your devices walks the run from here on. Its
 * steps still run where they are placed. Offered when you have another
 * device online, for a run that has not ended for good. It lives above the
 * menu, which unmounts when it closes, so a move on its way stays visible.
 */
export function useMoveRun(run: RunDetail, now: RunNow) {
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
				toast.success(`${to?.name ?? "The device"} continues the run.`);
				runActed(input.runId);
			},
			onError: (error) => toast.error(`Could not move: ${error.message}`),
		}),
	);
	return {
		// A run that ended for good has nothing to move.
		offered: targets.length > 0 && (now.allows.move || !now.ended),
		targets,
		blocked: now.whyNot.move,
		pending: move.isPending,
		moveTo: (deviceId: string) => move.mutate({ runId: run.id, deviceId }),
	};
}

/** The "Move to…" entry of the run's menu, with the devices it can go to. */
export function MoveSubmenu({ move }: { move: ReturnType<typeof useMoveRun> }) {
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger
				disabled={move.blocked !== null}
				className="data-disabled:pointer-events-none data-disabled:opacity-50"
			>
				<ArrowRightLeftIcon />
				<ActionText label="Move to…" hint={move.blocked} />
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="w-64">
				<DropdownMenuGroup>
					<DropdownMenuLabel>Continue the run on</DropdownMenuLabel>
					{move.targets.map((d) => (
						<DropdownMenuItem
							key={d.deviceId}
							onClick={() => move.moveTo(d.deviceId)}
						>
							<MonitorIcon />
							{d.thisDevice ? `${d.name} (this computer)` : d.name}
						</DropdownMenuItem>
					))}
				</DropdownMenuGroup>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}
