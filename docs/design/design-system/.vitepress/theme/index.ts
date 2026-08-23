// Custom VitePress theme: extends the default theme and registers the global
// <Demo> component used to embed live React component demos in markdown pages.
import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import Demo from "./Demo.vue";
import "./demo.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("Demo", Demo);
  },
} satisfies Theme;
