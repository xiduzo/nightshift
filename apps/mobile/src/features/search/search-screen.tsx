import { Input } from "@nightshift/ui-native/components/ui/input";
import { Search } from "lucide-react-native";
import { useState } from "react";

import { EmptyState } from "@/shared/empty";
import { LargeTitleHeader } from "@/shared/header";
import { Screen } from "@/shared/page";

/** Search your Gates and runs. A sheet from the headers of Home, Inbox and Runs. */
export function SearchScreen() {
	const [query, setQuery] = useState("");
	return (
		<Screen>
			<LargeTitleHeader compact title="Search" />
			<Input
				value={query}
				onChangeText={setQuery}
				placeholder="Gates and runs"
				accessibilityLabel="Search Gates and runs"
				autoFocus
				autoCorrect={false}
				returnKeyType="search"
			/>
			<EmptyState
				icon={Search}
				title="Find a Gate or a run"
				description="Type a word from its question, its flow or its project."
			/>
		</Screen>
	);
}
