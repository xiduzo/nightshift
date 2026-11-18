import type { ContextItem } from "@nightshift/client";

import { CodeBlock } from "@/shared/markdown";
import {
	NativeCustomRow,
	NativeRow,
	NativeSection,
} from "@/shared/native-list";
import { MarkdownRow } from "./brief-sections";
import { questionSections } from "./gate-view";

/**
 * What a Gate shows below its headline: the rest of the question, short
 * labelled values as rows with their value ("At a glance"), and longer
 * text and code each under its label. Text reads as Markdown. Code
 * scrolls sideways.
 */
export function QuestionSections({
	context,
}: {
	context: readonly ContextItem[];
}) {
	const { body, glance, sections } = questionSections(context);
	return (
		<>
			{body.length > 0 ? (
				<NativeSection title="The question">
					{body.map((text, index) => (
						<MarkdownRow key={index} text={text} />
					))}
				</NativeSection>
			) : null}
			{glance.length > 0 ? (
				<NativeSection title="At a glance">
					{glance.map((fact) => (
						<NativeRow key={fact.label} title={fact.label} value={fact.value} />
					))}
				</NativeSection>
			) : null}
			{sections.map((section, index) => (
				<NativeSection key={`${section.label}:${index}`} title={section.label}>
					{section.kind === "code" ? (
						<NativeCustomRow>
							<CodeBlock code={section.value} language={section.language} />
						</NativeCustomRow>
					) : (
						<MarkdownRow text={section.value} />
					)}
				</NativeSection>
			))}
		</>
	);
}
