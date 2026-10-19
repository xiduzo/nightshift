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

import { GateMarkdown } from "@/components/gate/gate-markdown";

/** One labelled piece of what a Gate shows below its question. */
export type ContextItem = {
	label: string | null;
	kind: "text" | "code";
	/** The fence's language, for code. */
	language?: string;
	value: string;
};

const FENCE = /```([\w+-]*)[^\n]*\n([\s\S]*?)(?:\n```|$)/g;
/** A line that is only a label: `Diff:`, `Plan summary:`. */
const LABEL_LINE = /^([^\n:]{1,48}):\s*$/;

/**
 * Splits a rendered question into the question itself (its first paragraph)
 * and the context after it. Fenced code becomes a code item; a paragraph
 * that opens with a `Label:` line becomes a labelled item. Display only: the
 * text stays exactly what the flow rendered.
 */
export function parseGateQuestion(question: string): {
	headline: string;
	context: ContextItem[];
} {
	const blocks: ContextItem[] = [];
	const pushText = (text: string) => {
		for (const paragraph of text.split(/\n\s*\n/)) {
			const trimmed = paragraph.trim();
			if (trimmed === "") continue;
			blocks.push({ label: null, kind: "text", value: trimmed });
		}
	};
	let last = 0;
	for (const match of question.matchAll(FENCE)) {
		pushText(question.slice(last, match.index));
		blocks.push({
			label: null,
			kind: "code",
			language: match[1] || undefined,
			value: match[2] ?? "",
		});
		last = match.index + match[0].length;
	}
	pushText(question.slice(last));

	const first = blocks[0];
	if (first?.kind !== "text") {
		return { headline: question.trim(), context: [] };
	}

	const context: ContextItem[] = [];
	for (const block of blocks.slice(1)) {
		if (block.kind === "code") {
			// "Diff:" right above a fence names the fence.
			const previous = context.at(-1);
			const label = previous?.kind === "text" ? labelOnly(previous) : null;
			if (previous && label) context.pop();
			context.push({ ...block, label: label ?? block.language ?? null });
			continue;
		}
		const [firstLine = "", ...rest] = block.value.split("\n");
		const label = LABEL_LINE.exec(firstLine)?.[1] ?? null;
		context.push(
			label && rest.length > 0
				? { label, kind: "text", value: rest.join("\n").trim() }
				: block,
		);
	}
	return { headline: first.value, context };
}

function labelOnly(item: ContextItem): string | null {
	if (item.label !== null || item.value.includes("\n")) return null;
	return LABEL_LINE.exec(item.value)?.[1] ?? null;
}

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
				{headline}
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
 * The context of a Gate: text as Markdown, code as code blocks. `plain`
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
					{item.kind === "code" ? (
						<CodeBlock size="sm" className="bg-muted/40">
							<CodeBlockActions>
								<CodeBlockCopyButton value={item.value} />
							</CodeBlockActions>
							<CodeBlockContent className="max-h-72 text-xs">
								{item.language === "diff" ? diffLines(item.value) : item.value}
							</CodeBlockContent>
						</CodeBlock>
					) : (
						<GateMarkdown text={item.value} />
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
