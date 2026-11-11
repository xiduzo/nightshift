import { Badge } from "@nightshift/ui/components/badge";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { ThumbsUpIcon } from "lucide-react";
import type { ReactNode } from "react";
import { outcomeLabel } from "@/features/flows";
import type { OpenGate } from "@/shared/api";
import { InlineMarkdown, Markdown } from "@/shared/markdown";
import { WrittenByModel } from "../written-by-model";

type Brief = OpenGate["brief"];
type Part = Brief["byModel"][number];

/**
 * The handover of an open Gate: why you decide (Situation), what is
 * already done (Background, each item with where it comes from), and the
 * option the flow recommends (Recommendation). An empty part is left out.
 * A part a model wrote says so, quietly. Nothing when the brief is empty.
 */
export function GateHandover({ brief }: { brief: Brief }) {
	const { situation, background, recommendation, byModel } = brief;
	const recommends =
		recommendation && (recommendation.option || recommendation.reason)
			? recommendation
			: null;
	if (!situation && background.length === 0 && !recommends) return null;
	const by = (part: Part) => byModel.includes(part);

	return (
		<div className="flex flex-col gap-6">
			{situation ? (
				<HandoverSection title="Situation" byModel={by("situation")}>
					<Markdown text={situation} />
				</HandoverSection>
			) : null}
			{background.length > 0 ? (
				<HandoverSection title="Background" byModel={by("background")}>
					<ItemGroup className="gap-1.5">
						{background.map((item, index) => (
							<Item key={index} variant="outline" size="xs">
								<ItemContent className="min-w-0">
									<ItemDescription className="line-clamp-none text-foreground text-sm">
										<InlineMarkdown text={item.text} />
									</ItemDescription>
								</ItemContent>
								{item.source ? (
									<Badge variant="secondary" className="max-w-40 truncate">
										{item.source}
									</Badge>
								) : null}
							</Item>
						))}
					</ItemGroup>
				</HandoverSection>
			) : null}
			{recommends ? (
				<HandoverSection title="Recommendation" byModel={by("recommendation")}>
					<Item variant="muted" size="sm">
						<ItemMedia variant="icon">
							<ThumbsUpIcon />
						</ItemMedia>
						<ItemContent className="min-w-0">
							{recommends.option ? (
								<ItemTitle className="font-mono">
									{outcomeLabel(recommends.option)}
								</ItemTitle>
							) : null}
							{recommends.reason ? (
								<ItemDescription className="line-clamp-none">
									<InlineMarkdown text={recommends.reason} />
								</ItemDescription>
							) : null}
						</ItemContent>
					</Item>
				</HandoverSection>
			) : null}
		</div>
	);
}

function HandoverSection({
	title,
	byModel,
	children,
}: {
	title: string;
	byModel: boolean;
	children: ReactNode;
}) {
	return (
		<section className="flex min-w-0 flex-col gap-2">
			<h2 className="flex flex-wrap items-baseline gap-x-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
				{title}
				{byModel ? <WrittenByModel /> : null}
			</h2>
			<div className="min-w-0">{children}</div>
		</section>
	);
}
