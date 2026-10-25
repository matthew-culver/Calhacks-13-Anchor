import type { Metadata } from "next";
import { ConvexClientProvider } from "./ConvexClientProvider";
import "./globals.css";

export const metadata: Metadata = {
  // Each page names itself ("Protect your email · Anchor"), so a screen reader or a browser
  // tab says where you are (WCAG 2.4.2).
  title: { default: "Anchor", template: "%s · Anchor" },
  description: "Keeps scam emails away from your parents, and keeps you in the loop.",
  // Invite and parent links carry secret tokens: never send them in the Referer
  // header, and keep every page out of search results.
  // strict-origin-when-cross-origin sends other sites only our origin, never the path with
  // the token. Not "no-referrer": that makes the invite form send `Origin: null`, which
  // /gmail/start rejects as cross-site.
  referrer: "strict-origin-when-cross-origin",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
