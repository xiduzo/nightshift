import { platformName } from "@nightshift/client";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { RunSummary } from "@/shared/api";
import { computerIcon } from "./computer-detail";
import type { SpaceComputer } from "./space-view";
import { ComputerStatus, computerLine } from "./status-badges";

/** How many runs a card names before "and N more". */
const SHOWN_RUNS = 2;

/**
 * One computer of the Space on the Devices page: whose it is, whether it is
 * online, what runs on it now, and how many projects and Offers it has. The
 * whole card opens its detail. `nudge` is the one action it offers.
 */
export function ComputerCard({
	computer,
	runs,
	now,
	nudge,
}: {
	computer: SpaceComputer;
	/** The Space's runs on their way, on this computer. */
	runs: RunSummary[];
	now: number;
	nudge?: ReactNode;
}) {
	const Icon = computerIcon(computer.platform);
	const away = computer.paired?.revokedAt != null || computer.online === false;
	return (
		<Card
			size="sm"
			className={cn(
				"relative transition-colors hover:bg-muted/40",
				away && "opacity-70",
			)}
		>
			<CardHeader>
				<CardTitle className="flex min-w-0 items-center gap-2">
					<Icon className="size-4 shrink-0 text-muted-foreground" />
					<Link
						to="/devices"
						search={(prev) => ({ ...prev, device: computer.id })}
						className="truncate after:absolute after:inset-0"
					>
						{computer.name}
					</Link>
				</CardTitle>
				<CardDescription className="truncate">
					{computer.thisDevice
						? "This computer"
						: computer.mine
							? "Yours"
							: (computer.owner ?? "A member")}
					{computer.platform ? ` · ${platformName(computer.platform)}` : ""}
				</CardDescription>
				<CardAction>
					<ComputerStatus computer={computer} />
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-col gap-1.5">
				{runs.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{computerLine(computer, now)}
					</p>
				) : (
					runs.slice(0, SHOWN_RUNS).map((run) => (
						<p key={run.id} className="truncate text-sm">
							<span
								aria-hidden
								className="mr-1.5 inline-block size-1.5 rounded-full bg-status-running align-middle"
							/>
							{run.title}
						</p>
					))
				)}
				{runs.length > SHOWN_RUNS ? (
					<p className="text-muted-foreground text-xs">
						and {runs.length - SHOWN_RUNS} more
					</p>
				) : null}
			</CardContent>
			<CardFooter className="gap-3 text-muted-foreground text-xs">
				<span>
					{computer.clones.length}{" "}
					{computer.clones.length === 1 ? "project" : "projects"}
				</span>
				<span>
					{computer.offers.length}{" "}
					{computer.offers.length === 1
						? "profile offered"
						: "profiles offered"}
				</span>
				{nudge ? <span className="relative z-10 ml-auto">{nudge}</span> : null}
			</CardFooter>
		</Card>
	);
}
