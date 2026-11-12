import { Button } from "@nightshift/ui/components/button";
import { ButtonGroup } from "@nightshift/ui/components/button-group";
import {
	Card,
	CardAction,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { CopyIcon, DownloadIcon, FileTextIcon } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/shared/markdown";

/**
 * The report an End step wrote: what the run produced, in full, as
 * Markdown. Copy it, or download it as a `.md` file. Images show as links,
 * so nothing loads from another server.
 */
export function RunReport({
	text,
	cut,
	fileName,
}: {
	text: string;
	/** Night Shift kept only the first 64 KB. */
	cut: boolean;
	/** The name it downloads as. */
	fileName: string;
}) {
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			toast.success("Copied the report as Markdown.");
		} catch {
			toast.error("Could not copy. Allow this page to use the clipboard.");
		}
	};
	const download = () => {
		const url = URL.createObjectURL(
			new Blob([text], { type: "text/markdown;charset=utf-8" }),
		);
		const link = document.createElement("a");
		link.href = url;
		link.download = fileName;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	};

	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 [&>svg]:size-4 [&>svg]:text-muted-foreground">
					<FileTextIcon aria-hidden="true" />
					Report
				</CardTitle>
				<CardAction>
					<ButtonGroup>
						<Button variant="outline" size="xs" onClick={() => void copy()}>
							<CopyIcon data-icon="inline-start" />
							Copy
						</Button>
						<Button variant="outline" size="xs" onClick={download}>
							<DownloadIcon data-icon="inline-start" />
							Download
						</Button>
					</ButtonGroup>
				</CardAction>
			</CardHeader>
			<CardContent>
				<Markdown text={text} imagesAsLinks className="max-w-none" />
			</CardContent>
			{cut ? (
				<CardFooter className="text-muted-foreground text-xs">
					Night Shift kept the first 64 KB of this report.
				</CardFooter>
			) : null}
		</Card>
	);
}
