import type { AskAttachment } from "@nightshift/flows";
import {
	Attachment,
	AttachmentContent,
	AttachmentGroup,
	AttachmentMedia,
	AttachmentTitle,
	AttachmentTrigger,
} from "@nightshift/ui/components/attachment";
import { cn } from "@nightshift/ui/lib/utils";
import { ExternalLinkIcon, FileIcon } from "lucide-react";
import { SERVER_URL } from "@/shared/api";

/** Where the computer that walks the run serves a file the run kept. */
function fileUrl(runId: string, artifactId: string): string {
	return `${SERVER_URL}/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`;
}

/**
 * The files and links of an Ask, or of one of its choices: an image shows
 * inline, a file and a link open in a new tab. The run keeps its files on
 * the computer that walks it, so another computer shows only their names
 * (`filesHere` false).
 */
export function AskAttachments({
	runId,
	attachments,
	filesHere,
	className,
}: {
	runId: string;
	attachments: readonly AskAttachment[];
	filesHere: boolean;
	className?: string;
}) {
	if (attachments.length === 0) return null;
	return (
		<AttachmentGroup className={cn("gap-2", className)}>
			{attachments.map((attachment, index) => (
				<AskAttachmentTile
					key={`${attachment.artifactId ?? attachment.url ?? ""}-${index}`}
					runId={runId}
					attachment={attachment}
					filesHere={filesHere}
				/>
			))}
		</AttachmentGroup>
	);
}

function AskAttachmentTile({
	runId,
	attachment,
	filesHere,
}: {
	runId: string;
	attachment: AskAttachment;
	filesHere: boolean;
}) {
	const { artifactId, url, label } = attachment;
	const href =
		url ?? (artifactId && filesHere ? fileUrl(runId, artifactId) : null);
	const image =
		artifactId !== undefined &&
		filesHere &&
		(attachment.mediaType ?? "").startsWith("image/");
	return (
		<Attachment orientation="vertical" className="w-40">
			<AttachmentMedia
				variant={image ? "image" : "icon"}
				className="aspect-video *:[img]:aspect-video"
			>
				{image && href ? (
					<img src={href} alt={label} loading="lazy" />
				) : url ? (
					<ExternalLinkIcon />
				) : (
					<FileIcon />
				)}
			</AttachmentMedia>
			<AttachmentContent className="w-full">
				<AttachmentTitle title={label}>{label}</AttachmentTitle>
			</AttachmentContent>
			{href ? (
				<AttachmentTrigger
					aria-label={`Open ${label}`}
					render={<a href={href} target="_blank" rel="noreferrer" />}
				/>
			) : null}
		</Attachment>
	);
}
