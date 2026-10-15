import { Button } from "@nightshift/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ChevronRightIcon,
	CircleStopIcon,
	CircleXIcon,
	ClipboardCopyIcon,
} from "lucide-react";
import { toast } from "sonner";

import { RunStatusBadge } from "@/components/run-status-badge";
import type { RunDetail, RunStatus } from "@/lib/api-types";
import { formatCost, formatDateTime } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export function RunHeader({
	run,
	status,
	reconnecting,
}: {
	run: RunDetail;
	status: RunStatus;
	reconnecting: boolean;
}) {
	const queryClient = useQueryClient();
	const projects = useQuery(orpc.projects.list.queryOptions());
	const project = projects.data?.find((p) => p.id === run.projectId);

	const stopRun = useMutation(
		orpc.runs.stop.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: orpc.runs.key() }),
			onError: (error) => toast.error(`Could not stop: ${error.message}`),
		}),
	);

	const takeOver = async () => {
		if (!run.takeOverCommand) return;
		try {
			await navigator.clipboard.writeText(run.takeOverCommand);
			toast.success("Command copied. Paste it in a terminal to take over.");
		} catch {
			toast.error("Could not copy. Copy the command from the tooltip.");
		}
	};

	const details: [string, string, boolean][] = [
		["Flow", run.flowName ?? "Quick run", run.flowName !== null],
		["Branch", run.branch, true],
		["Base", run.baseRef, true],
		["Cost", formatCost(run.costUsd), false],
		["Started", formatDateTime(run.createdAt), false],
	];

	return (
		<header className="flex flex-col gap-2 border-b px-4 py-3">
			<div className="flex flex-wrap items-center gap-2">
				<nav
					aria-label="Breadcrumb"
					className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs"
				>
					<Link
						to="/projects/$projectId"
						params={{ projectId: run.projectId }}
						className="truncate outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
					>
						{project?.name ?? "Project"}
					</Link>
					<ChevronRightIcon className="size-3 shrink-0" aria-hidden="true" />
					{run.flowName ? (
						<>
							<Link
								to="/projects/$projectId/flows/$name"
								params={{ projectId: run.projectId, name: run.flowName }}
								className="truncate font-mono outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
							>
								{run.flowName}
							</Link>
							<ChevronRightIcon
								className="size-3 shrink-0"
								aria-hidden="true"
							/>
						</>
					) : null}
					<span>Run</span>
				</nav>
				<div aria-live="polite" className="flex items-center gap-2">
					<RunStatusBadge status={status} />
					{reconnecting ? (
						<span className="text-muted-foreground text-xs">
							Reconnecting to the live transcript…
						</span>
					) : null}
				</div>
				<div className="ml-auto flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={takeOver}
						disabled={!run.takeOverCommand}
						title={run.takeOverCommand ?? "No agent session to take over yet."}
					>
						<ClipboardCopyIcon data-icon="inline-start" />
						Take over
					</Button>
					{status === "running" ? (
						<Button
							variant="destructive"
							size="sm"
							onClick={() => stopRun.mutate({ runId: run.id })}
							disabled={stopRun.isPending}
						>
							<CircleStopIcon data-icon="inline-start" />
							{stopRun.isPending ? "Stopping…" : "Stop"}
						</Button>
					) : null}
				</div>
			</div>
			<h1 className="line-clamp-2 whitespace-pre-wrap break-words font-medium text-sm">
				{run.title}
			</h1>
			{status === "failed" && run.reason ? (
				<p
					role="alert"
					className="flex items-start gap-1.5 border border-destructive/50 bg-destructive/10 px-2 py-1.5 text-destructive text-xs"
				>
					<CircleXIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
					<span className="whitespace-pre-wrap break-words">{run.reason}</span>
				</p>
			) : null}
			<dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
				{details.map(([label, value, mono]) => (
					<div key={label} className="flex min-w-0 gap-1">
						<dt className="text-muted-foreground">{label}</dt>
						<dd className={mono ? "truncate font-mono" : "truncate"}>
							{value}
						</dd>
					</div>
				))}
				<div className="flex min-w-0 basis-full gap-1">
					<dt className="text-muted-foreground">Worktree</dt>
					<dd className="truncate font-mono" title={run.worktreePath}>
						{run.worktreePath}
					</dd>
				</div>
			</dl>
		</header>
	);
}
