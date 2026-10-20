/** The items of a Command step: its log lines and its exit. */
import {
	CodeBlock,
	CodeBlockActions,
	CodeBlockContent,
	CodeBlockCopyButton,
	CodeBlockLine,
} from "@nightshift/ui/components/code-block";
import {
	Marker,
	MarkerContent,
	MarkerIcon,
} from "@nightshift/ui/components/marker";
import { CircleCheckIcon, CircleXIcon } from "lucide-react";
import { formatTime } from "@/shared/format";
import type { ExitItem, LogItem } from "../transcript";

/** A command's output as it streamed; stderr in the destructive colour. */
export function CommandLog({ item }: { item: LogItem }) {
	return (
		<CodeBlock size="sm">
			<CodeBlockActions>
				<CodeBlockCopyButton
					value={item.chunks.map((chunk) => chunk.text).join("")}
				/>
			</CodeBlockActions>
			<CodeBlockContent wrap className="max-h-[36rem]">
				<CodeBlockLine className="wrap-anywhere">
					{item.chunks.map((chunk, index) => (
						<span
							// Chunks only grow at the end, so the index is stable.
							key={index}
							className={
								chunk.stream === "stderr" ? "text-destructive" : undefined
							}
						>
							{chunk.text}
						</span>
					))}
				</CodeBlockLine>
			</CodeBlockContent>
		</CodeBlock>
	);
}

export function CommandExit({ item }: { item: ExitItem }) {
	const passed = item.exitCode === 0;
	return (
		<Marker className="text-xs">
			<MarkerIcon>
				{passed ? (
					<CircleCheckIcon className="size-3.5 text-outcome-pass" />
				) : (
					<CircleXIcon className="size-3.5 text-outcome-fail" />
				)}
			</MarkerIcon>
			<MarkerContent>
				{item.exitCode === null
					? "The command ended without a result"
					: passed
						? "The command succeeded"
						: `The command failed with code ${item.exitCode}`}{" "}
				· {formatTime(item.at)}
			</MarkerContent>
		</Marker>
	);
}
