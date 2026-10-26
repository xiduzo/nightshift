import { Card } from "@nightshift/ui-native/components/ui/card";
import { Separator } from "@nightshift/ui-native/components/ui/separator";
import {
	Text,
	TextClassContext,
} from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Fragment, type ReactNode, useContext, useMemo } from "react";
import { Text as RNText, ScrollView, View } from "react-native";
import { Renderer, useMarkdown } from "react-native-marked";

import { diffLineTone, linkTarget, listMarker } from "./markdown-view";

/** A link in the text: a web page opens in the in-app browser. */
function openLink(href: string) {
	const target = linkTarget(href);
	if (target === "browser") void WebBrowser.openBrowserAsync(href);
	else if (target === "system") void Linking.openURL(href).catch(() => {});
}

/**
 * Code, monospace, as one block that scrolls sideways. A diff marks its
 * added and removed lines.
 */
export function CodeBlock({
	code,
	language,
}: {
	code: string;
	language?: string;
}) {
	const lines = language === "diff" ? code.split("\n") : null;
	return (
		<Card className="gap-0 overflow-hidden bg-muted py-0">
			<ScrollView horizontal>
				<Text selectable className="p-3 font-mono text-xs">
					{lines
						? lines.map((line, index) => {
								const tone = diffLineTone(line);
								return (
									<RNText
										key={index}
										className={cn(
											tone === "added" && "text-status-finished",
											tone === "removed" && "text-destructive",
										)}
									>
										{index < lines.length - 1 ? `${line}\n` : line}
									</RNText>
								);
							})
						: code}
				</Text>
			</ScrollView>
		</Card>
	);
}

type Inline = string | ReactNode[];

/**
 * Draws Markdown with the app's own pieces and tokens. A block of text is a
 * React Native Reusables `Text`. Bold, italic, code and links inside it are
 * nested text, so they keep the size and color of the block around them.
 */
class BlockRenderer extends Renderer {
	constructor(private readonly textClass: string | undefined) {
		super({ selectable: true });
	}

	override paragraph(children: ReactNode[]): ReactNode {
		return <View key={this.getKey()}>{children}</View>;
	}

	override blockquote(children: ReactNode[]): ReactNode {
		return (
			<TextClassContext.Provider
				key={this.getKey()}
				value={cn(this.textClass, "text-muted-foreground")}
			>
				<View className="gap-2 border-border border-l-2 pl-3">{children}</View>
			</TextClassContext.Provider>
		);
	}

	override heading(text: Inline): ReactNode {
		return (
			<Text
				key={this.getKey()}
				selectable
				accessibilityRole="header"
				className="pt-1 font-semibold"
			>
				{text}
			</Text>
		);
	}

	override code(text: string, language?: string): ReactNode {
		return <CodeBlock key={this.getKey()} code={text} language={language} />;
	}

	override hr(): ReactNode {
		return <Separator key={this.getKey()} />;
	}

	override listItem(children: ReactNode[]): ReactNode {
		return (
			<View key={this.getKey()} className="min-w-0 flex-1 gap-1">
				{children}
			</View>
		);
	}

	override list(
		ordered: boolean,
		li: ReactNode[],
		_listStyle?: unknown,
		_textStyle?: unknown,
		startIndex?: number,
	): ReactNode {
		return (
			<View key={this.getKey()} className="gap-1">
				{li.map((item, index) => (
					<View key={index} className="flex-row gap-2">
						<Text className="min-w-4">
							{listMarker(ordered, startIndex, index)}
						</Text>
						{item}
					</View>
				))}
			</View>
		);
	}

	override text(text: Inline): ReactNode {
		// A string is a run of words inside a block; a list is the block.
		if (typeof text === "string") return text;
		return (
			<Text key={this.getKey()} selectable className="leading-relaxed">
				{text}
			</Text>
		);
	}

	override escape(text: string): ReactNode {
		return text;
	}

	override html(text: Inline): ReactNode {
		// Raw HTML shows as text.
		return this.text(text);
	}

	override strong(children: Inline): ReactNode {
		return (
			<RNText key={this.getKey()} className="font-semibold">
				{children}
			</RNText>
		);
	}

	override em(children: Inline): ReactNode {
		return (
			<RNText key={this.getKey()} className="italic">
				{children}
			</RNText>
		);
	}

	override del(children: Inline): ReactNode {
		return (
			<RNText key={this.getKey()} className="line-through">
				{children}
			</RNText>
		);
	}

	override codespan(text: string): ReactNode {
		return (
			<RNText key={this.getKey()} className="bg-muted font-mono">
				{text}
			</RNText>
		);
	}

	override br(): ReactNode {
		return "\n";
	}

	override link(children: Inline, href: string): ReactNode {
		if (linkTarget(href) === null) return children;
		return (
			<RNText
				key={this.getKey()}
				accessibilityRole="link"
				onPress={() => openLink(href)}
				className="text-primary underline"
			>
				{children}
			</RNText>
		);
	}

	override image(_uri: string, alt?: string, _style?: unknown, title?: string) {
		// The phone does not load pictures from the text: it shows their words.
		const words = alt || title;
		return words ? this.text([words]) : null;
	}

	override linkImage(
		href: string,
		_imageUrl: string,
		alt?: string,
		_style?: unknown,
		title?: string,
	): ReactNode {
		return this.text([this.link(alt || title || href, href)]);
	}

	override table(header: ReactNode[][], rows: ReactNode[][][]): ReactNode {
		const row = (cells: ReactNode[][], head: boolean, index: number) => (
			<View
				key={index}
				className={cn("flex-row", index > 0 && "border-border border-t")}
			>
				{cells.map((cell, column) => (
					<View
						key={column}
						className={cn("w-40 p-2", column > 0 && "border-border border-l")}
					>
						<Text selectable className={cn(head && "font-semibold")}>
							{cell}
						</Text>
					</View>
				))}
			</View>
		);
		return (
			<ScrollView key={this.getKey()} horizontal>
				<View className="rounded-md border border-border">
					{row(header, true, 0)}
					{rows.map((cells, index) => row(cells, false, index + 1))}
				</View>
			</ScrollView>
		);
	}
}

/**
 * The same pieces in one line, for a line inside a heading: blocks lose
 * their box, so a heading or a list in it reads as text.
 */
class InlineRenderer extends BlockRenderer {
	override paragraph(children: ReactNode[]): ReactNode {
		return <Fragment key={this.getKey()}>{children}</Fragment>;
	}

	override blockquote(children: ReactNode[]): ReactNode {
		return this.paragraph(children);
	}

	override heading(text: Inline): ReactNode {
		return <Fragment key={this.getKey()}>{text}</Fragment>;
	}

	override code(text: string): ReactNode {
		return this.codespan(text);
	}

	override hr(): ReactNode {
		return null;
	}

	override listItem(children: ReactNode[]): ReactNode {
		return this.paragraph(children);
	}

	override list(
		ordered: boolean,
		li: ReactNode[],
		_listStyle?: unknown,
		_textStyle?: unknown,
		startIndex?: number,
	): ReactNode {
		return (
			<Fragment key={this.getKey()}>
				{li.map((item, index) => (
					<Fragment key={index}>
						{index > 0 ? "\n" : null}
						{`${listMarker(ordered, startIndex, index)} `}
						{item}
					</Fragment>
				))}
			</Fragment>
		);
	}

	override text(text: Inline): ReactNode {
		if (typeof text === "string") return text;
		return <Fragment key={this.getKey()}>{text}</Fragment>;
	}

	override table(header: ReactNode[][], rows: ReactNode[][][]): ReactNode {
		return (
			<Fragment key={this.getKey()}>
				{[header, ...rows].map((cells, index) => (
					<Fragment key={index}>
						{index > 0 ? "\n" : null}
						{cells.map((cell, column) => (
							<Fragment key={column}>
								{column > 0 ? " · " : null}
								{cell}
							</Fragment>
						))}
					</Fragment>
				))}
			</Fragment>
		);
	}
}

/**
 * Text an agent or a flow wrote, as Markdown: headings, lists, code, tables
 * and links. Raw HTML in it shows as text. `className` sets the text of
 * every block, such as "text-sm".
 */
export function Markdown({
	text,
	className,
}: {
	text: string;
	className?: string;
}) {
	const outer = useContext(TextClassContext);
	const textClass = cn(outer, className);
	const renderer = useMemo(() => new BlockRenderer(textClass), [textClass]);
	const nodes = useMarkdown(text, { renderer });
	return (
		<TextClassContext.Provider value={textClass}>
			<View className="min-w-0 gap-2">{nodes}</View>
		</TextClassContext.Provider>
	);
}

/**
 * One line an agent or a flow wrote, such as a Gate's question: bold,
 * italic, code and links. Put it inside a `Text`: it takes that text's size
 * and color.
 */
export function InlineMarkdown({ text }: { text: string }) {
	const renderer = useMemo(() => new InlineRenderer(undefined), []);
	const nodes = useMarkdown(text, { renderer });
	return (
		<>
			{nodes.map((node, index) => (
				<Fragment key={index}>
					{index > 0 ? "\n" : null}
					{node}
				</Fragment>
			))}
		</>
	);
}
