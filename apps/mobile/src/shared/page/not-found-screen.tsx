import { Button } from "@nightshift/ui-native/components/ui/button";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { Link } from "expo-router";
import { SearchX } from "lucide-react-native";

import { EmptyState } from "../empty";
import { Screen } from "./screen";

export function NotFoundScreen() {
	return (
		<Screen>
			<EmptyState
				icon={SearchX}
				title="This page does not exist"
				description="The link may be old."
			>
				<Link href="/needs" dismissTo asChild>
					<Button size="lg" className="h-auto min-h-11 py-2">
						<Text>Open Needs you</Text>
					</Button>
				</Link>
			</EmptyState>
		</Screen>
	);
}
