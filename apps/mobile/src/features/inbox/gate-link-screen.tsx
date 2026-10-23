import type { GateLink } from "@nightshift/client";
import { Badge } from "@nightshift/ui-native/components/ui/badge";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ExternalLink } from "lucide-react-native";
import { View } from "react-native";

import { ListGroup, ListRow } from "@/shared/list";
import { Screen } from "@/shared/page";
import { LINK_WORD, openLinkText } from "./gate-view";

const KINDS: readonly GateLink["kind"][] = ["pull", "issue", "ticket", "web"];

/**
 * One link of a Gate's question, as a sheet: what it is, where it lives,
 * the run it comes from, and the button that opens it in the browser.
 */
export function GateLinkScreen() {
	const params = useLocalSearchParams<{
		url: string;
		label: string;
		short: string;
		where: string;
		kind: string;
		from?: string;
	}>();
	const kind = KINDS.find((one) => one === params.kind) ?? "web";
	const link = { url: params.url, kind };
	return (
		<Screen>
			<View className="gap-2">
				<Badge variant="secondary" className="self-start">
					<Text>{LINK_WORD[kind]}</Text>
				</Badge>
				<Text className="font-mono text-muted-foreground text-sm">
					{params.short}
				</Text>
				<Text
					accessibilityRole="header"
					className="font-bold text-2xl tracking-tight"
				>
					{params.label}
				</Text>
				{params.where && params.where !== params.short ? (
					<Text className="text-muted-foreground text-sm">{params.where}</Text>
				) : null}
			</View>
			{params.from ? (
				<ListGroup>
					<ListRow overline="Linked from" title={params.from} />
				</ListGroup>
			) : null}
			<Button
				size="lg"
				onPress={() => void WebBrowser.openBrowserAsync(params.url)}
				accessibilityHint="Opens the page in the browser"
				className="h-auto min-h-11 py-2"
			>
				<Text>{openLinkText(link)}</Text>
				<Icon as={ExternalLink} className="text-primary-foreground" />
			</Button>
			<Text
				selectable
				className="text-muted-foreground text-xs"
				numberOfLines={2}
			>
				{params.url}
			</Text>
		</Screen>
	);
}
