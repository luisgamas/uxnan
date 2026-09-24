// The JavaScript the production frontend is compiled down to — one value, read by
// `vite.config.js` and pinned by `tests/build-target.test.mjs`.
//
// It is the oldest engine each platform's webview can be: WKWebView on macOS 11
// (the app's `minimumSystemVersion`) ships Safari 14; WebView2 on Windows is
// evergreen Chromium; WebKitGTK on Linux is newer than both. ES2021 is what all
// three already run natively.
//
// It must not fall below ES2021. Vite 6's default target (`es2020`, …) makes
// esbuild lower logical assignment (`a ||= b`) and, while minifying, esbuild
// 0.25 then drops the `let` it was assigning to — `let r; f(r ||= {})` ships as
// `f(void 0 || (r = {}))`, a ReferenceError in a module. xterm.js 6 compiles one
// of its TypeScript enums to exactly that shape inside `requestMode`, its DECRQM
// (`CSI ? Ps $ p`) handler, so the first TUI that asked the terminal which modes
// it supports (OpenCode 2) killed that terminal's parser: the tab froze and
// every byte after it was dropped. Not lowering the syntax at all is the fix.
export const BUILD_TARGET = ["es2021", "safari14", "chrome105"];
