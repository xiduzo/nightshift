import type { ContextItem } from "@nightshift/client";
import { Card } from "@nightshift/ui-native/components/ui/card";
import { View } from "react-native";

import { SectionHead } from "@/shared/list";
import { FactGrid, FactTile } from "@/shared/tiles";
import { questionSections } from "./gate-view";
import { CodeBlock, Markdown } from "./markdown";

/**
 * What a Gate shows below its headline: the rest of the question, short
 * labelled values as tiles ("At a glance"), and longer text and code each
 * under its label. Text reads as Markdown. Code scrolls sideways.
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
				<View className="gap-2">
					<SectionHead title="The question" />
					{body.map((text, index) => (
						<Markdown key={index} text={text} />
					))}
				</View>
			) : null}
			{glance.length > 0 ? (
				<View className="gap-2">
					<SectionHead title="At a glance" />
					<FactGrid>
						{glance.map((fact) => (
							<FactTile
								key={fact.label}
								label={fact.label}
								value={fact.value}
							/>
						))}
					</FactGrid>
				</View>
			) : null}
			{sections.map((section, index) => (
				<View key={`${section.label}:${index}`} className="gap-2">
					<SectionHead title={section.label} />
					{section.kind === "code" ? (
						<CodeBlock code={section.value} language={section.language} />
					) : (
						<Card className="px-4 py-3">
							<Markdown text={section.value} className="text-sm" />
						</Card>
					)}
				</View>
			))}
		</>
	);
}
