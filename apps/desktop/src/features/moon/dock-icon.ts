import { dlopen, FFIType, type Pointer, ptr } from "bun:ffi";

/**
 * Sets the Dock icon of the running app on macOS. Electrobun has no call for
 * it, so this asks AppKit through the Objective-C runtime:
 * `[NSApp performSelectorOnMainThread:@selector(setApplicationIconImage:) …]`.
 * AppKit takes the image only on the main thread. The icon of the app in
 * Finder and Spotlight stays the one in the bundle.
 */

const { pointer: P, bool: B } = FFIType;
const LIBOBJC = "/usr/lib/libobjc.A.dylib";

/** objc_msgSend with one signature. Each signature needs its own binding. */
function msgSend<F>(args: FFIType[], returns: FFIType): F {
	return dlopen(LIBOBJC, {
		objc_msgSend: { args: [P, P, ...args], returns },
	}).symbols.objc_msgSend as unknown as F;
}

type Runtime = {
	getClass: (name: Pointer) => Pointer | null;
	sel: (name: Pointer) => Pointer | null;
	send0: (target: Pointer, sel: Pointer) => Pointer | null;
	send1: (target: Pointer, sel: Pointer, a: Pointer) => Pointer | null;
	sendMain: (
		target: Pointer,
		sel: Pointer,
		a: Pointer,
		b: Pointer,
		wait: boolean,
	) => void;
};
let objc: Runtime | undefined;

function runtime(): Runtime {
	if (objc) return objc;
	const lib = dlopen(LIBOBJC, {
		objc_getClass: { args: [P], returns: P },
		sel_registerName: { args: [P], returns: P },
	}).symbols;
	const made: Runtime = {
		getClass: lib.objc_getClass as Runtime["getClass"],
		sel: lib.sel_registerName as Runtime["sel"],
		send0: msgSend([], P),
		send1: msgSend([P], P),
		sendMain: msgSend([P, P, B], FFIType.void),
	};
	objc = made;
	return made;
}

/** A C string the call can read. Keep the buffer alive while it runs. */
const cString = (text: string) => Buffer.from(`${text}\0`, "utf8");

/** Shows the image at `path` (a PNG) as the Dock icon. Does nothing off macOS. */
export function setDockIcon(path: string): void {
	if (process.platform !== "darwin") return;
	const o = runtime();
	const name = (text: string) => {
		const buffer = cString(text);
		return { buffer, at: ptr(buffer) };
	};
	const cls = (text: string) => {
		const n = name(text);
		const found = o.getClass(n.at);
		if (!found) throw new Error(`No Objective-C class ${text}.`);
		return found;
	};
	const sel = (text: string) => {
		const n = name(text);
		const found = o.sel(n.at);
		if (!found) throw new Error(`No selector ${text}.`);
		return found;
	};

	// alloc/init, not the autoreleasing constructors: this thread has no pool.
	const file = name(path);
	const string = o.send1(
		o.send0(cls("NSString"), sel("alloc")) as Pointer,
		sel("initWithUTF8String:"),
		file.at,
	);
	if (!string) return;
	const image = o.send1(
		o.send0(cls("NSImage"), sel("alloc")) as Pointer,
		sel("initWithContentsOfFile:"),
		string,
	);
	if (!image) return;
	const app = o.send0(cls("NSApplication"), sel("sharedApplication"));
	if (!app) return;
	o.sendMain(
		app,
		sel("performSelectorOnMainThread:withObject:waitUntilDone:"),
		sel("setApplicationIconImage:"),
		image,
		false,
	);
}
