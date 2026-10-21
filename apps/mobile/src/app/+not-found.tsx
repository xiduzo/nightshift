import { Stack } from "expo-router";

import { NotFoundScreen } from "@/shared/page";

export default function NotFound() {
	return (
		<>
			<Stack.Screen options={{ title: "Not found" }} />
			<NotFoundScreen />
		</>
	);
}
