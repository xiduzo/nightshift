import { createSpaceQueries } from "@nightshift/client";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui-native/components/ui/select";
import { cn } from "@nightshift/ui-native/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useHostQueries } from "@/features/host";
import { useSwitchSpace } from "./use-switch-space";

/**
 * The Space this phone works in, in a screen's header. Runs, projects and
 * starting a flow are per Space. Home and the inbox show every Space and do
 * not need it.
 */
export function SpacePicker({ className }: { className?: string }) {
	const spaceQueries = useHostQueries(createSpaceQueries);
	const spaces = useQuery(spaceQueries.list());
	const switchSpace = useSwitchSpace();
	const insets = useSafeAreaInsets();

	const list = spaces.data;
	if (!list) return null;
	const chosen = switchSpace.isPending
		? switchSpace.variables.spaceId
		: list.active;
	const active = list.spaces.find((space) => space.id === chosen);

	return (
		<Select
			value={active ? { value: active.id, label: active.name } : undefined}
			onValueChange={(option) => {
				if (option && option.value !== list.active) {
					switchSpace.mutate({ spaceId: option.value });
				}
			}}
			disabled={switchSpace.isPending}
		>
			<SelectTrigger
				className={cn("max-w-48", className)}
				accessibilityLabel="Choose the Space"
			>
				<SelectValue placeholder="Choose a Space" />
			</SelectTrigger>
			<SelectContent
				insets={{ top: insets.top, bottom: insets.bottom, right: 16 }}
				className="w-64"
			>
				<ScrollView className="max-h-80">
					<SelectGroup>
						<SelectLabel>Spaces</SelectLabel>
						{list.spaces.map((space) => (
							<SelectItem key={space.id} value={space.id} label={space.name} />
						))}
					</SelectGroup>
				</ScrollView>
			</SelectContent>
		</Select>
	);
}
