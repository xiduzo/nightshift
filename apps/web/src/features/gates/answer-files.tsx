import {
	type AnswerFile,
	MAX_ANSWER_FILES,
	MAX_ANSWER_FILES_BYTES,
} from "@nightshift/flows";
import {
	Attachment,
	AttachmentAction,
	AttachmentActions,
	AttachmentContent,
	AttachmentDescription,
	AttachmentGroup,
	AttachmentMedia,
	AttachmentTitle,
} from "@nightshift/ui/components/attachment";
import { Button } from "@nightshift/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { cn } from "@nightshift/ui/lib/utils";
import { FileIcon, PaperclipIcon, XIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatSize } from "@/shared/format";

/**
 * The files a person adds to an answer: picked or dropped, shown as tiles,
 * each with a remove button. `problem` says when they are too many or too
 * large to send. `read` gives them as the answer takes them.
 */
export function useAnswerFiles() {
	const [files, setFiles] = useState<File[]>([]);
	const bytes = files.reduce((sum, file) => sum + file.size, 0);
	const problem =
		files.length > MAX_ANSWER_FILES
			? `Add at most ${MAX_ANSWER_FILES} files.`
			: bytes > MAX_ANSWER_FILES_BYTES
				? `The files are larger than ${MAX_ANSWER_FILES_BYTES / 1024 / 1024} MB together. Remove a file.`
				: null;
	return {
		files,
		problem,
		add: (more: readonly File[]) =>
			setFiles((current) => [
				...current,
				// The same file twice is one file.
				...more.filter(
					(file) =>
						!current.some(
							(one) =>
								one.name === file.name &&
								one.size === file.size &&
								one.lastModified === file.lastModified,
						),
				),
			]),
		remove: (file: File) =>
			setFiles((current) => current.filter((one) => one !== file)),
		clear: () => setFiles([]),
		/** The files as the answer takes them, or undefined when there are none. */
		read: async (): Promise<AnswerFile[] | undefined> =>
			files.length === 0 ? undefined : Promise.all(files.map(answerFileOf)),
	};
}

export type AnswerFiles = ReturnType<typeof useAnswerFiles>;

/** One file as base64, without the `data:` prefix. */
function answerFileOf(file: File): Promise<AnswerFile> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () =>
			reject(reader.error ?? new Error(`${file.name} was not read.`));
		reader.onload = () => {
			const url = String(reader.result);
			resolve({
				name: file.name,
				mediaType: file.type,
				content: url.slice(url.indexOf(",") + 1),
			});
		};
		reader.readAsDataURL(file);
	});
}

/**
 * The Files field of an answer: a button that picks files, a drop on the
 * field, and a tile per file. An image shows inline.
 */
export function AnswerFilesField({
	files,
	disabled,
}: {
	files: AnswerFiles;
	disabled: boolean;
}) {
	const id = useId();
	const input = useRef<HTMLInputElement>(null);
	const [over, setOver] = useState(false);

	return (
		<Field
			className={cn(
				"gap-2 rounded-lg transition-colors",
				over && "bg-muted/60 outline-dashed outline-2 outline-ring",
			)}
			onDragOver={(event) => {
				if (disabled || !event.dataTransfer.types.includes("Files")) return;
				event.preventDefault();
				setOver(true);
			}}
			onDragLeave={() => setOver(false)}
			onDrop={(event) => {
				setOver(false);
				if (disabled || event.dataTransfer.files.length === 0) return;
				event.preventDefault();
				files.add([...event.dataTransfer.files]);
			}}
		>
			<FieldLabel htmlFor={id}>
				Files
				<span className="font-normal text-muted-foreground">(optional)</span>
			</FieldLabel>
			{files.files.length > 0 ? (
				<AttachmentGroup className="flex-wrap gap-2 overflow-visible">
					{files.files.map((file) => (
						<PickedFile
							key={`${file.name}-${file.size}-${file.lastModified}`}
							file={file}
							disabled={disabled}
							onRemove={() => files.remove(file)}
						/>
					))}
				</AttachmentGroup>
			) : null}
			<input
				ref={input}
				id={id}
				type="file"
				multiple
				hidden
				disabled={disabled}
				aria-describedby={`${id}-hint`}
				onChange={(event) => {
					files.add([...(event.target.files ?? [])]);
					// The same file may be picked again after a remove.
					event.target.value = "";
				}}
			/>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="self-start"
				disabled={disabled}
				onClick={() => input.current?.click()}
			>
				<PaperclipIcon data-icon="inline-start" />
				Add files
			</Button>
			<FieldDescription id={`${id}-hint`} className="text-xs">
				The next agent steps of the run can read them. Up to {MAX_ANSWER_FILES}{" "}
				files, {MAX_ANSWER_FILES_BYTES / 1024 / 1024} MB together.
			</FieldDescription>
			{files.problem ? <FieldError>{files.problem}</FieldError> : null}
		</Field>
	);
}

/** One picked file: its preview or kind, its name and size, and a remove button. */
function PickedFile({
	file,
	disabled,
	onRemove,
}: {
	file: File;
	disabled: boolean;
	onRemove: () => void;
}) {
	const image = file.type.startsWith("image/");
	const preview = useMemo(
		() => (image ? URL.createObjectURL(file) : null),
		[file, image],
	);
	useEffect(
		() => () => {
			if (preview) URL.revokeObjectURL(preview);
		},
		[preview],
	);
	return (
		<Attachment size="sm" className="max-w-full">
			<AttachmentMedia variant={preview ? "image" : "icon"}>
				{preview ? <img src={preview} alt="" /> : <FileIcon />}
			</AttachmentMedia>
			<AttachmentContent>
				<AttachmentTitle title={file.name}>{file.name}</AttachmentTitle>
				<AttachmentDescription>{formatSize(file.size)}</AttachmentDescription>
			</AttachmentContent>
			<AttachmentActions>
				<AttachmentAction
					aria-label={`Remove ${file.name}`}
					title="Remove"
					disabled={disabled}
					onClick={onRemove}
				>
					<XIcon />
				</AttachmentAction>
			</AttachmentActions>
		</Attachment>
	);
}
