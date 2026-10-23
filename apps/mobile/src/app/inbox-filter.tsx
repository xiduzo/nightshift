import { SignedInOnly } from "@/features/host";
import { InboxFilterScreen } from "@/features/inbox";

export default function InboxFilterRoute() {
	return (
		<SignedInOnly>
			<InboxFilterScreen />
		</SignedInOnly>
	);
}
