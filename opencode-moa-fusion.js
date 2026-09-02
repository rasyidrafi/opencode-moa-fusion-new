// OpenCode loads this stable entrypoint as the plugin. Keep the implementation
// exports in dist/index.js available for tests and library consumers, but expose
// only the plugin function here because OpenCode treats every legacy export as
// a plugin entrypoint.
export { default } from "./dist/index.js";
