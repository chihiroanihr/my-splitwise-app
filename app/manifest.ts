import type { MetadataRoute } from "next";

/**
 * Lets friends keep the app on their home screen. `standalone` drops the
 * browser chrome, which matters here because the floating "支払いを追加" button
 * sits right where Safari's toolbar would otherwise be.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "精算アプリ",
    short_name: "精算",
    description: "友達と割り勘を管理するアプリ。ログイン不要で、招待リンクから参加できます。",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8fafc",
    theme_color: "#0ea5e9",
    lang: "ja",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
