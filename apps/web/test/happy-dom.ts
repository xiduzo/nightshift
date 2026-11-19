// The tests of the web app run in a DOM (happy-dom). `bunfig.toml` loads
// this file before any test file, so every module sees the same `window`
// whichever test loads it first. A render test (`*.test.tsx`) mounts
// components with `@testing-library/react` and fires keys at the window.

import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:3001/" });
