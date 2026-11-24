import { toast } from "sonner";

/** The `onError` of a request: a toast that says what did not work, and why. */
export function toastFailure(title: string) {
	return (error: { message: string }) => {
		toast.error(`${title}: ${error.message}`);
	};
}
