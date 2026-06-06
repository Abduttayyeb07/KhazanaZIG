import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZIG Khazana",
  description: "Core engine dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-surface" suppressHydrationWarning>{children}</body>
    </html>
  );
}
