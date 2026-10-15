import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Textarea } from "@nightshift/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ChevronRightIcon,
	CircleStopIcon,
	ClipboardCopyIcon,
	PlayIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { RunStatusBadge } from "@/components/run-status-badge";
import { RunTranscript } from "@/components/transcript/run-transcript";
import { useRunStream } from "@/hooks/use-run-stream";
import type { RunDetail, RunStatus } from "@/lib/api-types";
import { formatCost, formatDateTime } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/runs/$runId")({
	// The transcript streams from the browser; nothing to render on the server.
	ssr: false,
	component: RunComponent,
});

function RunComponent() {
	const { runId } = Route.useParams();
	const run = useQuery(orpc.runs.get.queryOptions({ input: { runId } }));
	const stream = useRunStream(runId);

	if (run.isLoading) {
		return (
			<main className="flex flex-col gap-3 px-4 py-4">
				<Skeleton className="h-5 w-64" />
				<Skeleton className="h-4 w-full max-w-2xl" />
				<Skeleton className="h-40 w-full" />
			</main>
		);
	}

	if (!run.data) {
		return (
			<main className="px-4 py-6">
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>Run not available</EmptyTitle>
						<EmptyDescription>
							{run.error?.message ?? "This run does not exist."}{" "}
							<Link to="/">Back to projects</Link>
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</main>
		);
	}

	// The stream reports a status change before the refetched run arrives.
	const status = stream.status ?? run.data.status;
	const running = status === "running";

	return (
		<main className="grid min-h-0 grid-rows-[auto_1fr_auto]">
			<RunHeader
				run={run.data}
				status={status}
				reconnecting={stream.connection === "reconnecting"}
			/>
			<RunTranscript
				run={run.data}
				transcript={stream.transcript}
				running={running}
				connecting={stream.connection === "connecting"}
			/>
			{running ? null : <ResumeComposer runId={run.data.id} />}
		</main>
	);
}

function RunHeader({
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
		["Model", run.model, false],
		["Branch", run.branch, true],
		["Base", run.baseRef, true],
		["Permissions", run.permissionMode, false],
		...(run.effort
			? [["Effort", run.effort, false] as [string, string, boolean]]
			: []),
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
				{run.prompt}
			</h1>
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

function ResumeComposer({ runId }: { runId: string }) {
	const id = useId();
	const queryClient = useQueryClient();
	const [prompt, setPrompt] = useState("");

	const resumeRun = useMutation(
		orpc.runs.resume.mutationOptions({
			onSuccess: () => {
				setPrompt("");
				void queryClient.invalidateQueries({ queryKey: orpc.runs.key() });
			},
		}),
	);

	const submit = () => {
		if (resumeRun.isPending) return;
		resumeRun.mutate({ runId, prompt: prompt.trim() || undefined });
	};

	return (
		<form
			className="border-t bg-background px-4 py-3"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<div className="mx-auto flex max-w-4xl flex-col gap-2">
				<label
					htmlFor={`${id}-prompt`}
					className="text-muted-foreground text-xs"
				>
					Follow-up prompt (optional). Resuming continues the same agent session
					in the same worktree.
				</label>
				<div className="flex items-end gap-2">
					<Textarea
						id={`${id}-prompt`}
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								submit();
							}
						}}
						placeholder="Tell the agent what to do next…"
						className="max-h-40 min-h-9 text-sm md:text-sm"
						rows={1}
					/>
					<Button type="submit" disabled={resumeRun.isPending}>
						<PlayIcon data-icon="inline-start" />
						{resumeRun.isPending ? "Resuming…" : "Resume"}
					</Button>
				</div>
				{resumeRun.error ? (
					<p role="alert" className="text-destructive text-xs">
						{resumeRun.error.message}
					</p>
				) : null}
			</div>
		</form>
	);
}
