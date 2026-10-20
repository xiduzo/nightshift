import { Spinner } from "@nightshift/ui/components/spinner";

export default function Loader() {
	return (
		<div className="flex h-full flex-1 items-center justify-center p-8 text-muted-foreground">
			<Spinner className="size-5" />
		</div>
	);
}
