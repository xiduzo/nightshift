import type { OpenGate } from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { type Href, Link } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { View } from "react-native";

/**
 * "Acme › website › Fix the login bug": the run opens its screen.
 */
export function Breadcrumbs({
	gate,
	manySpaces,
	runHref,
}: {
	gate: OpenGate;
	manySpaces: boolean;
	runHref: Href;
}) {
	return (
		<View className="flex-row flex-wrap items-center gap-x-1">
			{manySpaces ? (
				<>
					<Text className="text-muted-foreground text-sm">
						{gate.spaceName}
					</Text>
					<Icon as={ChevronRight} className="size-3.5 text-muted-foreground" />
				</>
			) : null}
			<Crumb label={gate.projectName} href={undefined} />
			<Icon as={ChevronRight} className="size-3.5 text-muted-foreground" />
			<Crumb label={gate.runTitle} href={runHref} />
		</View>
	);
}

function Crumb({ label, href }: { label: string; href: Href | undefined }) {
	if (!href) {
		return (
			<Text className="flex-shrink text-muted-foreground text-sm">{label}</Text>
		);
	}
	return (
		<Link href={href} asChild>
			<Button
				variant="link"
				size="sm"
				className="h-auto min-h-11 flex-shrink px-0 py-2"
			>
				<Text className="text-sm" numberOfLines={1}>
					{label}
				</Text>
			</Button>
		</Link>
	);
}
