import { runActions, useRunActed } from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MoonIcon, SunriseIcon } from "lucide-react";
import { toast } from "sonner";
import { runMutations } from "@/features/runs/queries";
import type { RunSummary } from "@/shared/api";
import { orpc } from "@/shared/api";
import { formatCountdown, formatTime, useNow } from "@/shared/format";
import { LocalTime } from "@/shared/time";

/** How long until a sleeping run wakes, again each second. Only this text updates. */
function WakeCountdown({ at }: { at: number }) {
	const now = useNow(1000);
	return (
		<span className="font-mono tabular-nums">
			({formatCountdown(at - now)})
		</span>
	);
}

/**
 * Runs that wait on a usage limit or the network. Each one continues on
 * its own. The device that runs one can wake it now.
 */
export function SleepingRuns({
	runs,
	projectNames,
}: {
	runs: readonly RunSummary[];
	projectNames: ReadonlyMap<string, string>;
}) {
	const runActed = useRunActed({ orpc });
	const wake = useMutation(
		runMutations.resume({
			onSuccess: (_, { runId }) => runActed(runId),
			onError: (error) => toast.error(`Could not wake: ${error.message}`),
		}),
	);

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6 md:px-8">
			<p className="text-muted-foreground text-xs">
				Each one continues on its own.
			</p>
			<ItemGroup className="gap-1.5">
				{runs.map((run) => {
					const waking = wake.isPending && wake.variables?.runId === run.id;
					return (
						<Item key={run.id} size="sm" variant="outline">
							<ItemMedia variant="icon" className="text-status-sleeping">
								<MoonIcon />
							</ItemMedia>
							<ItemContent className="min-w-0">
								<ItemTitle className="w-full min-w-0">
									<Link
										to="/runs/$runId"
										params={{ runId: run.id }}
										className="truncate underline-offset-3 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
									>
										{run.title}
									</Link>
								</ItemTitle>
								<ItemDescription className="truncate text-xs">
									{projectNames.get(run.projectId) ?? "Project"}
									{run.wakeAt ? (
										<>
											{" · "}
											<span className="text-status-sleeping">
												wakes{" "}
												<LocalTime at={run.wakeAt}>
													{formatTime(run.wakeAt)}
												</LocalTime>{" "}
												<WakeCountdown at={run.wakeAt} />
											</span>
										</>
									) : null}
								</ItemDescription>
							</ItemContent>
							{/* Only the device that runs it wakes it. */}
							{runActions(run.status, run.walker.thisDevice, run.result)
								.resume ? (
								<ItemActions>
									<Tooltip>
										<TooltipTrigger
											render={
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Wake ${run.title} now`}
													disabled={waking}
													onClick={() => wake.mutate({ runId: run.id })}
												/>
											}
										>
											{waking ? <Spinner /> : <SunriseIcon />}
										</TooltipTrigger>
										<TooltipContent>Wake now</TooltipContent>
									</Tooltip>
								</ItemActions>
							) : null}
						</Item>
					);
				})}
			</ItemGroup>
		</div>
	);
}
