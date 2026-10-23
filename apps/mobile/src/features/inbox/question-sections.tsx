import type { ContextItem } from "@nightshift/client";
import { Card } from "@nightshift/ui-native/components/ui/card";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { ScrollView, View } from "react-native";

import { SectionHead } from "@/shared/list";
import { FactGrid, FactTile } from "@/shared/tiles";
import { questionSections } from "./gate-view";

/**
 * What a Gate shows below its headline: the rest of the question, short
 * labelled values as tiles ("At a glance"), and longer text and code each
 * under its label. Code scrolls sideways.
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
					{body.map((paragraph, index) => (
						<Text key={index} selectable>
							{paragraph}
						</Text>
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
						<Card className="gap-0 overflow-hidden bg-muted py-0">
							<ScrollView horizontal>
								<Text selectable className="p-3 font-mono text-xs">
									{section.value}
								</Text>
							</ScrollView>
						</Card>
					) : (
						<Card className="px-4 py-3">
							<Text selectable className="text-sm">
								{section.value}
							</Text>
						</Card>
					)}
				</View>
			))}
		</>
	);
}
