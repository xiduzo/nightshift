import { Badge } from "@nightshift/ui-native/components/ui/badge";
import { Card } from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Separator } from "@nightshift/ui-native/components/ui/separator";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { ThumbsUp } from "lucide-react-native";
import { Fragment } from "react";
import { View } from "react-native";

import { SectionHead } from "@/shared/list";
import { type BriefView, WRITTEN_BY_NIGHT_SHIFT } from "./brief-view";
import { InlineMarkdown, Markdown } from "./markdown";

/**
 * The brief of a Gate, above its question: Situation (why you decide),
 * Background (what is already done, each item with its source as a small
 * Badge) and Recommendation (the option the flow recommends, and why).
 * An empty part stays out. A part that Night Shift wrote says so, quietly.
 */
export function BriefSections({ brief }: { brief: BriefView }) {
	const { situation, background, recommendation } = brief;
	return (
		<>
			{situation ? (
				<View className="gap-2">
					<SectionHead
						title="Situation"
						hint={situation.byModel ? WRITTEN_BY_NIGHT_SHIFT : undefined}
					/>
					<Markdown text={situation.text} />
				</View>
			) : null}
			{background ? (
				<View className="gap-2">
					<SectionHead
						title="Background"
						hint={background.byModel ? WRITTEN_BY_NIGHT_SHIFT : undefined}
					/>
					<Card className="gap-0 py-0">
						{background.items.map((item, index) => (
							<Fragment key={`${item.text}:${index}`}>
								{index > 0 ? <Separator /> : null}
								<View
									className="gap-1.5 px-4 py-3"
									accessible
									accessibilityLabel={
										item.source
											? `${item.text}, from ${item.source}`
											: item.text
									}
								>
									<Text className="text-sm" selectable>
										<InlineMarkdown text={item.text} />
									</Text>
									{item.source ? (
										<Badge variant="secondary" className="self-start">
											<Text numberOfLines={1}>{item.source}</Text>
										</Badge>
									) : null}
								</View>
							</Fragment>
						))}
					</Card>
				</View>
			) : null}
			{recommendation ? (
				<View className="gap-2">
					<SectionHead
						title="Recommendation"
						hint={recommendation.byModel ? WRITTEN_BY_NIGHT_SHIFT : undefined}
					/>
					<Card className="flex-row gap-3 px-4 py-3">
						<Icon as={ThumbsUp} className="mt-0.5 size-4 text-primary" />
						<View className="flex-1 gap-1">
							{recommendation.option ? (
								<Text className="font-semibold text-base">
									{recommendation.option}
								</Text>
							) : null}
							{recommendation.reason ? (
								<Markdown
									text={recommendation.reason}
									className={
										recommendation.option
											? "text-muted-foreground text-sm"
											: "text-sm"
									}
								/>
							) : null}
						</View>
					</Card>
				</View>
			) : null}
		</>
	);
}
