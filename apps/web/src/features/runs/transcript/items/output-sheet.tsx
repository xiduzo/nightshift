import { Button } from "@nightshift/ui/components/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@nightshift/ui/components/sheet";
import { CodeView } from "@/shared/code";

/** Output longer than this many lines or characters opens in a sheet. */
export const PREVIEW_LINES = 20;
export const PREVIEW_CHARS = 1500;

/** Whether the output is too long to show in the transcript itself. */
export function isLongOutput(content: string): boolean {
	return (
		content.length > PREVIEW_CHARS || content.split("\n").length > PREVIEW_LINES
	);
}

/** "Show all": the whole output of a call or command, in a sheet beside the transcript. */
export function OutputSheet({
	title,
	content,
	language,
}: {
	/** What made the output: the command, the file, the tool. */
	title: string;
	content: string;
	language: string;
}) {
	const lines = content.split("\n").length;
	return (
		<Sheet>
			<SheetTrigger
				render={<Button variant="link" size="xs" className="self-start px-0" />}
			>
				Show all ({lines.toLocaleString()} lines)
			</SheetTrigger>
			<SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
				<SheetHeader>
					<SheetTitle className="truncate font-mono">{title}</SheetTitle>
					<SheetDescription>
						{lines.toLocaleString()} lines, {content.length.toLocaleString()}{" "}
						characters
					</SheetDescription>
				</SheetHeader>
				<CodeView
					code={content}
					language={language}
					className="mx-4 mb-4 min-h-0 w-auto flex-1"
					contentClassName="max-h-none"
				/>
			</SheetContent>
		</Sheet>
	);
}
