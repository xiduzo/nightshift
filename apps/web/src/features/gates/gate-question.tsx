import { type ContextItem, parseGateQuestion } from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import {
	CodeBlock,
	CodeBlockActions,
	CodeBlockContent,
	CodeBlockCopyButton,
	CodeBlockLine,
} from "@nightshift/ui/components/code-block";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import { cn } from "@nightshift/ui/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

import { CodeView } from "@/shared/code";
import { InlineMarkdown, Markdown } from "@/shared/markdown";

/** Context longer than this folds away behind "Show context". */
const LONG_CONTEXT = 480;

/**
 * The question a Gate asks: its first paragraph as the prominent line, the
 * rest as labelled context blocks. Long context starts folded.
 */
export function GateQuestion({
	question,
	headingId,
	className,
}: {
	question: string;
	/** Put on the headline, for `aria-labelledby` on the card. */
	headingId?: string;
	className?: string;
}) {
	const { headline, context } = parseGateQuestion(question);
	const size = context.reduce((sum, item) => sum + item.value.length, 0);
	const long = size > LONG_CONTEXT || context.length > 3;

	return (
		<div className={cn("flex min-w-0 flex-col gap-3", className)}>
			<h2
				id={headingId}
				className="max-w-prose whitespace-pre-wrap break-words font-semibold text-base leading-snug tracking-tight"
			>
				<InlineMarkdown text={headline} />
			</h2>
			{context.length === 0 ? null : long ? (
				<Collapsible className="flex flex-col gap-3">
					<CollapsibleTrigger
						render={
							<Button
								variant="ghost"
								size="sm"
								className="group/trigger -ml-2 w-fit text-muted-foreground"
							/>
						}
					>
						<ChevronDownIcon
							data-icon="inline-start"
							className="-rotate-90 transition-transform group-data-[panel-open]/trigger:rotate-0 motion-reduce:transition-none"
						/>
						<span className="group-data-[panel-open]/trigger:hidden">
							Show context
						</span>
						<span className="hidden group-data-[panel-open]/trigger:inline">
							Hide context
						</span>
						<span className="font-normal tabular-nums">
							· {context.length} {context.length === 1 ? "part" : "parts"}
						</span>
					</CollapsibleTrigger>
					<CollapsibleContent>
						<ContextList items={context} />
					</CollapsibleContent>
				</Collapsible>
			) : (
				<ContextList items={context} />
			)}
		</div>
	);
}

/**
 * The context of a Gate: text as Markdown, code and JSON as highlighted code
 * blocks, a diff with its added and removed lines marked. `plain`
 * drops the rule on the left, for a pane that holds nothing else.
 */
export function ContextList({
	items,
	plain = false,
}: {
	items: ContextItem[];
	plain?: boolean;
}) {
	return (
		<div className={cn("flex min-w-0 flex-col", plain ? "gap-4" : "gap-3")}>
			{items.map((item, index) => (
				<ContextBlock key={index} label={item.label} plain={plain}>
					{item.kind === "code" && item.language === "diff" ? (
						<CodeBlock size="sm" className="bg-muted/40">
							<CodeBlockActions>
								<CodeBlockCopyButton value={item.value} />
							</CodeBlockActions>
							<CodeBlockContent className="max-h-72 text-xs">
								{diffLines(item.value)}
							</CodeBlockContent>
						</CodeBlock>
					) : item.kind === "code" ? (
						<CodeView
							code={item.value}
							language={item.language ?? "text"}
							className="bg-muted/40"
							contentClassName="max-h-72 text-xs"
						/>
					) : (
						<Markdown text={item.value} />
					)}
				</ContextBlock>
			))}
		</div>
	);
}

/** A unified diff, one line each, with added and removed lines marked. */
function diffLines(value: string): ReactNode[] {
	return value.split("\n").map((line, index) => {
		const added = line.startsWith("+") && !line.startsWith("+++");
		const removed = line.startsWith("-") && !line.startsWith("---");
		return (
			<CodeBlockLine
				key={index}
				variant={added ? "added" : removed ? "removed" : "default"}
			>
				{added || removed ? line.slice(1) : line}
			</CodeBlockLine>
		);
	});
}

function ContextBlock({
	label,
	plain,
	children,
}: {
	label: string | null;
	plain: boolean;
	children: ReactNode;
}) {
	return (
		<div
			className={cn("flex min-w-0 flex-col gap-1", !plain && "border-l-2 pl-3")}
		>
			{label ? (
				<div className="font-mono text-muted-foreground text-xs">{label}</div>
			) : null}
			<div className="min-w-0">{children}</div>
		</div>
	);
}
