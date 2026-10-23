import { createSpaceQueries } from "@nightshift/client";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { cn } from "@nightshift/ui-native/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { FolderGit2, Inbox, Users } from "lucide-react-native";
import { View } from "react-native";

import { useHostQueries } from "@/features/host";
import { LargeTitleHeader } from "@/shared/header";
import { ListGroup, ListRow } from "@/shared/list";
import { Screen } from "@/shared/page";
import { setInboxView, useInboxView } from "./inbox-filter";
import {
	type PlaceOption,
	placeOptions,
	samePlace,
	spaceCount,
} from "./inbox-view";
import { useInbox } from "./use-inbox";

/** The sheet of the inbox's place chip: every Gate, one Space or one project. */
export function InboxFilterScreen() {
	const inbox = useInbox();
	const view = useInboxView();
	const spaceQueries = useHostQueries(createSpaceQueries);
	const spaces = useQuery(spaceQueries.list());
	const gates = inbox.data ?? [];
	const manySpaces = spaces.data
		? spaces.data.spaces.length > 1
		: spaceCount(gates) > 1;
	const options = placeOptions(gates, manySpaces);

	function choose(option: PlaceOption) {
		setInboxView({ place: option.place });
		if (router.canGoBack()) router.back();
		else router.replace("/inbox");
	}

	return (
		<Screen>
			<LargeTitleHeader
				compact
				title="Show Gates from"
				summary="Choose a project or a Space."
			/>
			<ListGroup>
				{options.map((option) => {
					const shown = samePlace(option.place, view.place);
					return (
						<ListRow
							key={placeKey(option)}
							leading={
								<View
									className={cn(
										"size-8 items-center justify-center",
										option.nested && "ml-6",
									)}
								>
									<Icon
										as={iconOf(option)}
										className="size-5 text-muted-foreground"
									/>
								</View>
							}
							title={option.label}
							titleLines={1}
							value={String(option.count)}
							selected={shown}
							onPress={() => choose(option)}
							accessibilityLabel={`${option.label}, ${option.count} open`}
							accessibilityHint="Shows the Gates of this place in the inbox"
						/>
					);
				})}
			</ListGroup>
		</Screen>
	);
}

function iconOf(option: PlaceOption) {
	switch (option.place.kind) {
		case "all":
			return Inbox;
		case "space":
			return Users;
		case "project":
			return FolderGit2;
	}
}

function placeKey({ place }: PlaceOption): string {
	switch (place.kind) {
		case "all":
			return "all";
		case "space":
			return `space:${place.spaceId}`;
		case "project":
			return `project:${place.projectId}`;
	}
}
