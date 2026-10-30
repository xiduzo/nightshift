import {
	Attachment,
	AttachmentAction,
	AttachmentActions,
	AttachmentContent,
	AttachmentDescription,
	AttachmentMedia,
	AttachmentTitle,
	AttachmentTrigger,
} from "@nightshift/ui/components/attachment";
import { Button } from "@nightshift/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import {
	DownloadIcon,
	FileIcon,
	FileTextIcon,
	ImagesIcon,
	VideoIcon,
} from "lucide-react";
import { useState } from "react";

import {
	type Artifact,
	type RunDetail,
	SERVER_URL,
	type StepSummary,
} from "@/shared/api";
import { formatDateTime, formatSize, formatTime } from "@/shared/format";
import { Markdown } from "@/shared/markdown";
import { SetBy } from "./run-variables";

/** Where the daemon serves one artifact's file. */
function artifactUrl(runId: string, artifact: Artifact, download = false) {
	const url = `${SERVER_URL}/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifact.id)}`;
	return download ? `${url}?download` : url;
}

type Kind = "image" | "video" | "markdown" | "text" | "file";

function kindOf(artifact: Artifact): Kind {
	const [type] = artifact.mediaType.split("/");
	if (type === "image") return "image";
	if (type === "video") return "video";
	if (
		artifact.mediaType === "text/markdown" ||
		/\.(md|markdown)$/i.test(artifact.name)
	) {
		return "markdown";
	}
	if (type === "text" || artifact.mediaType === "application/json") {
		return "text";
	}
	return "file";
}

const KIND_ICON = {
	image: ImagesIcon,
	video: VideoIcon,
	markdown: FileTextIcon,
	text: FileTextIcon,
	file: FileIcon,
} as const;

/**
 * The files the run's agents kept for the person: screenshots, recordings,
 * reports. An image or a video opens large; every file downloads.
 */
export function RunArtifacts({
	run,
	steps,
	artifacts,
	onShowStep,
}: {
	run: RunDetail;
	steps: StepSummary[];
	artifacts: Artifact[];
	onShowStep: (stepId: string) => void;
}) {
	const [openId, setOpenId] = useState<string | null>(null);
	const open = artifacts.find((artifact) => artifact.id === openId);

	if (artifacts.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<ImagesIcon />
					</EmptyMedia>
					<EmptyTitle>No artifacts yet</EmptyTitle>
					<EmptyDescription>
						{run.walker.thisDevice
							? "Agents keep screenshots, recordings and other files of this run here."
							: `Artifacts stay on the device that ran the step. Open this run on ${run.walker.name ?? "that device"} to see them.`}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<>
			<div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3 p-3">
				{artifacts.map((artifact) => (
					<ArtifactTile
						key={artifact.id}
						runId={run.id}
						artifact={artifact}
						onOpen={() => setOpenId(artifact.id)}
					/>
				))}
			</div>
			<Dialog
				open={open !== undefined}
				onOpenChange={(next) => {
					if (!next) setOpenId(null);
				}}
			>
				<DialogContent className="sm:max-w-4xl">
					{open ? (
						<ArtifactView
							runId={run.id}
							artifact={open}
							steps={steps}
							onShowStep={(stepId) => {
								setOpenId(null);
								onShowStep(stepId);
							}}
						/>
					) : null}
				</DialogContent>
			</Dialog>
		</>
	);
}

/** One artifact: a preview of an image or a video, else its kind, with its title. */
function ArtifactTile({
	runId,
	artifact,
	onOpen,
}: {
	runId: string;
	artifact: Artifact;
	onOpen: () => void;
}) {
	const kind = kindOf(artifact);
	const Icon = KIND_ICON[kind];
	return (
		<Attachment orientation="vertical" className="w-full">
			<AttachmentMedia
				variant={kind === "image" ? "image" : "icon"}
				className="aspect-video *:[img]:aspect-video"
			>
				{kind === "image" ? (
					<img src={artifactUrl(runId, artifact)} alt="" loading="lazy" />
				) : kind === "video" ? (
					<video
						src={`${artifactUrl(runId, artifact)}#t=0.1`}
						preload="metadata"
						muted
						className="size-full object-cover"
					/>
				) : (
					<Icon />
				)}
			</AttachmentMedia>
			<AttachmentContent className="w-full">
				<AttachmentTitle title={artifact.title}>
					{artifact.title}
				</AttachmentTitle>
				<AttachmentDescription>
					<time
						dateTime={new Date(artifact.savedAt).toISOString()}
						title={formatDateTime(artifact.savedAt)}
					>
						{formatTime(artifact.savedAt)}
					</time>{" "}
					· {formatSize(artifact.size)}
				</AttachmentDescription>
			</AttachmentContent>
			<AttachmentTrigger
				aria-label={`Open ${artifact.title}`}
				onClick={onOpen}
			/>
			<AttachmentActions>
				<AttachmentAction
					variant="secondary"
					aria-label={`Download ${artifact.title}`}
					title="Download"
					render={<a href={artifactUrl(runId, artifact, true)} download />}
					nativeButton={false}
				>
					<DownloadIcon />
				</AttachmentAction>
			</AttachmentActions>
		</Attachment>
	);
}

/** One artifact large: the image, the video, or the file to download. */
function ArtifactView({
	runId,
	artifact,
	steps,
	onShowStep,
}: {
	runId: string;
	artifact: Artifact;
	steps: StepSummary[];
	onShowStep: (stepId: string) => void;
}) {
	const kind = kindOf(artifact);
	const url = artifactUrl(runId, artifact);
	return (
		<>
			<DialogHeader>
				<DialogTitle>{artifact.title}</DialogTitle>
				<DialogDescription className="flex flex-wrap items-center gap-x-1.5">
					<span className="font-mono">{artifact.name}</span>
					<span>· {formatSize(artifact.size)} · Kept by</span>
					<SetBy
						change={{ stepId: artifact.stepId }}
						steps={steps}
						onShowStep={onShowStep}
					/>
					<span>at {formatDateTime(artifact.savedAt)}</span>
				</DialogDescription>
			</DialogHeader>
			{kind === "image" ? (
				<img
					src={url}
					alt={artifact.title}
					className="max-h-[70svh] w-full rounded-lg border bg-muted object-contain"
				/>
			) : kind === "video" ? (
				// biome-ignore lint/a11y/useMediaCaption: an agent's screen recording has no captions.
				<video
					src={url}
					controls
					className="max-h-[70svh] w-full rounded-lg border bg-muted"
				/>
			) : kind === "markdown" ? (
				<MarkdownArtifact url={url} />
			) : kind === "text" ? (
				<iframe
					src={url}
					title={artifact.title}
					sandbox=""
					className="h-[60svh] w-full rounded-lg border bg-muted"
				/>
			) : (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<FileIcon />
						</EmptyMedia>
						<EmptyTitle>No preview</EmptyTitle>
						<EmptyDescription>
							Download the file to open it on this computer.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
			<DialogFooter>
				<Button
					variant="outline"
					render={<a href={artifactUrl(runId, artifact, true)} download />}
					nativeButton={false}
				>
					<DownloadIcon data-icon="inline-start" />
					Download
				</Button>
			</DialogFooter>
		</>
	);
}

/** A Markdown file an agent kept, rendered for reading. */
function MarkdownArtifact({ url }: { url: string }) {
	const text = useQuery({
		queryKey: ["artifact-text", url],
		queryFn: async () => {
			const response = await fetch(url, { credentials: "include" });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.text();
		},
		staleTime: Number.POSITIVE_INFINITY,
	});
	if (text.isError) {
		return (
			<iframe
				src={url}
				title="Markdown file"
				sandbox=""
				className="h-[60svh] w-full rounded-lg border bg-muted"
			/>
		);
	}
	return (
		<div className="h-[60svh] overflow-y-auto rounded-lg border p-4">
			{text.data === undefined ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-4 w-1/3" />
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-4 w-5/6" />
				</div>
			) : (
				<Markdown text={text.data} className="max-w-none" />
			)}
		</div>
	);
}
