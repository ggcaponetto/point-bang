import { defineConfig } from "vitepress";
import typedocSidebar from "../api/typedoc-sidebar.json";

export default defineConfig({
  title: "point-bang",
  description: "Turn your phone into a PC lightgun — WebXR aim tracking, no extra hardware.",
  base: "/point-bang/",
  lastUpdated: true,
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/reference/protocol" },
      { text: "API", link: "/api/" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Getting Started (USB)", link: "/guide/getting-started" },
            { text: "Playing over WiFi", link: "/guide/wifi" },
            { text: "Buttons", link: "/guide/buttons" },
            { text: "Aim & Latency Tuning", link: "/guide/latency" },
            { text: "Troubleshooting", link: "/guide/troubleshooting" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "Protocol", link: "/reference/protocol" },
            { text: "Architecture", link: "/reference/architecture" },
            { text: "Development", link: "/reference/development" },
          ],
        },
      ],
      "/api/": [{ text: "API", items: typedocSidebar }],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/ggcaponetto/point-bang" }],
    search: { provider: "local" },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 ggcaponetto",
    },
  },
});
