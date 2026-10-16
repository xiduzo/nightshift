import {
	CodeBlock,
	CodeBlockActions,
	CodeBlockContent,
	CodeBlockCopyButton,
	CodeBlockHeader,
	CodeBlockLine,
	CodeBlockTitle,
} from "@nightshift/ui/components/code-block";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import { cn } from "@nightshift/ui/lib/utils";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { formatJson } from "@/lib/run-steps";

/**
 * Code in a shadcn code block, highlighted by Shiki once its language loads.
 * A language Shiki does not know (such as "text") shows the plain lines.
 */
export function CodeView({
	code,
	language,
	title,
	copy = true,
	className,
	contentClassName,
	variant,
}: {
	code: string;
	language: string;
	/** Shown in a header row above the code, next to the copy button. */
	title?: ReactNode;
	copy?: boolean;
	className?: string;
	/** Classes for the scrolling `pre`, such as a max height. */
	contentClassName?: string;
	variant?: "default" | "destructive";
}) {
	const lines = useHighlightedCode(code, language);
	const copyButton = copy ? (
		<CodeBlockActions>
			<CodeBlockCopyButton value={code} />
		</CodeBlockActions>
	) : null;
	return (
		<CodeBlock size="sm" variant={variant} className={className}>
			{title !== undefined ? (
				<CodeBlockHeader>
					<CodeBlockTitle>{title}</CodeBlockTitle>
					{copyButton}
				</CodeBlockHeader>
			) : (
				copyButton
			)}
			<CodeBlockContent wrap className={cn("max-h-80", contentClassName)}>
				{lines.map((line, index) => (
					// Lines only grow at the end while the code streams.
					<CodeBlockLine key={index} className="wrap-anywhere">
						{line}
					</CodeBlockLine>
				))}
			</CodeBlockContent>
		</CodeBlock>
	);
}

/** A JSON value, pretty-printed and highlighted in a scrollable code block. */
export function JsonBlock({
	value,
	className,
}: {
	value: unknown;
	/** Classes for the scrolling content, such as a max height. */
	className?: string;
}) {
	return (
		<CodeView
			code={formatJson(value)}
			language="json"
			contentClassName={cn("max-h-64", className)}
		/>
	);
}

/** A JSON value behind a summary line that opens it. */
export function JsonDetails({
	summary,
	value,
	open,
}: {
	summary: string;
	value: unknown;
	open?: boolean;
}) {
	return (
		<Collapsible defaultOpen={open} className="flex flex-col gap-1.5 text-xs">
			<CollapsibleTrigger className="group/json flex w-fit items-center gap-1 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
				<ChevronRightIcon
					aria-hidden="true"
					className="size-3.5 transition-transform group-aria-expanded/json:rotate-90 motion-reduce:transition-none"
				/>
				{summary}
			</CollapsibleTrigger>
			<CollapsibleContent>
				<JsonBlock value={value} />
			</CollapsibleContent>
		</Collapsible>
	);
}
