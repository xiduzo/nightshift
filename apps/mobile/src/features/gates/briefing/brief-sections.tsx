import { type BriefView, WRITTEN_BY_NIGHT_SHIFT } from "@nightshift/client";
import { ThumbsUp } from "lucide-react-native";
import { Markdown } from "@/shared/markdown";
import {
	NativeCustomRow,
	NativeSection,
	NativeTextRow,
} from "@/shared/native-list";
import { isInlineMarkdown } from "./gate-view";

/**
 * Text an agent or a flow wrote, as one row: a native text row for a
 * paragraph, the full Markdown view for lists, headings and code.
 */
export function MarkdownRow({ text }: { text: string }) {
	if (isInlineMarkdown(text)) return <NativeTextRow text={text} />;
	return (
		<NativeCustomRow>
			<Markdown text={text} className="text-sm" />
		</NativeCustomRow>
	);
}

/**
 * The brief of a Gate, above its question: Situation (why you decide),
 * Background (what is already done, each item with its source under it)
 * and Recommendation (the option the flow recommends, and why). An empty
 * part stays out. A part that Night Shift wrote says so, quietly, under
 * the group.
 */
export function BriefSections({ brief }: { brief: BriefView }) {
	const { situation, background, recommendation } = brief;
	return (
		<>
			{situation ? (
				<NativeSection
					title="Situation"
					footer={situation.byModel ? WRITTEN_BY_NIGHT_SHIFT : undefined}
				>
					<MarkdownRow text={situation.text} />
				</NativeSection>
			) : null}
			{background ? (
				<NativeSection
					title="Background"
					footer={background.byModel ? WRITTEN_BY_NIGHT_SHIFT : undefined}
				>
					{background.items.map((item, index) => (
						<NativeTextRow
							key={`${item.text}:${index}`}
							text={item.text}
							note={item.source ?? undefined}
						/>
					))}
				</NativeSection>
			) : null}
			{recommendation ? (
				<NativeSection
					title="Recommendation"
					footer={recommendation.byModel ? WRITTEN_BY_NIGHT_SHIFT : undefined}
				>
					<NativeTextRow
						icon={{ sf: "hand.thumbsup", lucide: ThumbsUp }}
						text={
							recommendation.option
								? `**${recommendation.option}**`
								: (recommendation.reason ?? "")
						}
						note={
							recommendation.option
								? (recommendation.reason ?? undefined)
								: undefined
						}
					/>
				</NativeSection>
			) : null}
		</>
	);
}
