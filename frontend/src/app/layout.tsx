import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZIG Khazana",
  description: "ZIG treasury performance, strategy, and market activity.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen" suppressHydrationWarning>{children}</body>
    </html>
  );
}
