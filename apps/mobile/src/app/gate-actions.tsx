import { SignedInOnly } from "@/features/host";
import { GateActionsScreen } from "@/features/inbox";

export default function GateActionsRoute() {
	return (
		<SignedInOnly>
			<GateActionsScreen />
		</SignedInOnly>
	);
}
