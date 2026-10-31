import { useRunActed } from "@nightshift/client";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
} from "@nightshift/ui/components/alert-dialog";
import { Badge } from "@nightshift/ui/components/badge";
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
import { useMutation } from "@tanstack/react-query";
import { HourglassIcon, LockIcon, LockOpenIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { orpc, type RunDetail } from "@/shared/api";
import { formatDateTime, formatRelative } from "@/shared/format";
import { runMutations } from "../queries";

type RunLease = RunDetail["leases"][number];

/**
 * The leases of a run (ADR 7): those it holds, and the one it waits for.
 * A person can let go of a lease the run holds, so another run takes it.
 */
export function RunLeases({ run }: { run: RunDetail }) {
	const [releasing, setReleasing] = useState<string | null>(null);
	const runActed = useRunActed({ orpc });
	const release = useMutation(
		runMutations.releaseLease({
			onSuccess: (_, { runId }) => runActed(runId),
			onError: (error) =>
				toast.error(`Could not release the lease: ${error.message}`),
		}),
	);
	if (run.leases.length === 0) return null;
	return (
		<>
			<ItemGroup className="gap-2">
				{run.leases.map((lease) => (
					<LeaseRow
						key={`${lease.state}:${lease.name}`}
						lease={lease}
						pending={
							release.isPending && release.variables?.name === lease.name
						}
						onRelease={() => setReleasing(lease.name)}
					/>
				))}
			</ItemGroup>
			<AlertDialog
				open={releasing !== null}
				onOpenChange={(open) => {
					if (!open) setReleasing(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogMedia>
							<LockOpenIcon />
						</AlertDialogMedia>
						<AlertDialogTitle>Release this lease?</AlertDialogTitle>
						<AlertDialogDescription>
							Another run can take <code>{releasing}</code> at once. This run
							goes on without it, and does not take it back.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep it</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (releasing !== null) {
									release.mutate({ runId: run.id, name: releasing });
								}
								setReleasing(null);
							}}
						>
							Release
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function LeaseRow({
	lease,
	pending,
	onRelease,
}: {
	lease: RunLease;
	pending: boolean;
	onRelease: () => void;
}) {
	const held = lease.state === "held";
	const since = (
		<time
			dateTime={new Date(lease.since).toISOString()}
			title={formatDateTime(lease.since)}
		>
			{formatRelative(lease.since)}
		</time>
	);
	return (
		<Item variant="outline" size="sm">
			<ItemMedia variant="icon">
				{held ? <LockIcon /> : <HourglassIcon />}
			</ItemMedia>
			<ItemContent>
				<ItemTitle>
					<span className="truncate font-mono">{lease.name}</span>
					<Badge variant={held ? "secondary" : "outline"}>
						{held ? "Holds" : "Waits"}
					</Badge>
				</ItemTitle>
				<ItemDescription>
					{held ? (
						<>
							Taken {since} by <code>{lease.nodeId}</code>. Held until the run{" "}
							{lease.section === null
								? "ends"
								: `leaves the Section ${lease.section}`}
							.
						</>
					) : lease.holder ? (
						<>
							The run “{lease.holder.title}” holds it. This run asked {since}.
						</>
					) : (
						<>
							Waits for the computer that keeps this Space. This run asked{" "}
							{since}.
						</>
					)}
				</ItemDescription>
			</ItemContent>
			{held ? (
				<ItemActions>
					<Button
						variant="outline"
						size="sm"
						disabled={pending}
						onClick={onRelease}
					>
						Release
					</Button>
				</ItemActions>
			) : null}
		</Item>
	);
}
