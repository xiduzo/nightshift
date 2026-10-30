import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import { cn } from "@nightshift/ui/lib/utils";
import { type ReactNode, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** A link in the text: it opens in a new tab. */
function TextLink({ href, children }: { href?: string; children?: ReactNode }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="break-all text-primary underline underline-offset-3"
		>
			{children}
		</a>
	);
}

/**
 * How a caller shows some links itself: its own node for the link, or
 * undefined to show it as a link that opens in a new tab.
 */
export type LinkView = (link: {
	href: string | undefined;
	children: ReactNode;
}) => ReactNode | undefined;

/** Every heading in the text sits below the title of the block that shows it. */
function Heading({ children }: { children?: React.ReactNode }) {
	return <h3 className="pt-1 font-semibold text-sm">{children}</h3>;
}

const COMPONENTS: Components = {
	h1: Heading,
	h2: Heading,
	h3: Heading,
	h4: Heading,
	h5: Heading,
	h6: Heading,
	p: ({ children }) => <p className="leading-relaxed">{children}</p>,
	ul: ({ children }) => (
		<ul className="flex list-disc flex-col gap-1 pl-5">{children}</ul>
	),
	ol: ({ children }) => (
		<ol className="flex list-decimal flex-col gap-1 pl-5">{children}</ol>
	),
	a: ({ href, children }) => <TextLink href={href}>{children}</TextLink>,
	code: ({ children }) => (
		<code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
			{children}
		</code>
	),
	pre: ({ children }) => (
		<pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-xs [&_code]:bg-transparent [&_code]:p-0">
			{children}
		</pre>
	),
	blockquote: ({ children }) => (
		<blockquote className="border-l-2 pl-3 text-muted-foreground">
			{children}
		</blockquote>
	),
	table: ({ children }) => <Table className="text-xs">{children}</Table>,
	thead: ({ children }) => <TableHeader>{children}</TableHeader>,
	tbody: ({ children }) => <TableBody>{children}</TableBody>,
	tr: ({ children }) => <TableRow>{children}</TableRow>,
	th: ({ children }) => <TableHead>{children}</TableHead>,
	td: ({ children }) => <TableCell>{children}</TableCell>,
};

/**
 * Text an agent or a flow wrote, as Markdown: headings, lists, code and links.
 * Raw HTML in it shows as text.
 */
export function Markdown({
	text,
	link,
	className,
}: {
	text: string;
	/** Shows some links in another way, such as a citation. */
	link?: LinkView;
	className?: string;
}) {
	const components = useMemo<Components>(
		() =>
			link
				? {
						...COMPONENTS,
						a: ({ href, children }) =>
							link({ href, children }) ?? (
								<TextLink href={href}>{children}</TextLink>
							),
					}
				: COMPONENTS,
		[link],
	);
	return (
		<div
			className={cn(
				"flex min-w-0 max-w-prose flex-col gap-2 break-words text-sm",
				className,
			)}
		>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
				{text}
			</ReactMarkdown>
		</div>
	);
}

const INLINE_ELEMENTS = ["p", "strong", "em", "del", "code", "a"];

/**
 * One line an agent or a flow wrote, such as a Gate's question: bold,
 * italic, code and links only. Put it inside a heading or a span. Without
 * `links`, a link shows as its text, for a line inside a link or a button.
 */
export function InlineMarkdown({
	text,
	links = true,
}: {
	text: string;
	links?: boolean;
}) {
	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm]}
			allowedElements={
				links ? INLINE_ELEMENTS : INLINE_ELEMENTS.filter((e) => e !== "a")
			}
			unwrapDisallowed
			components={{
				p: ({ children }) => children,
				a: COMPONENTS.a,
				code: COMPONENTS.code,
			}}
		>
			{text}
		</ReactMarkdown>
	);
}
