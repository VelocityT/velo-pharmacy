import type { Metadata, Viewport } from "next";

// Branding is per-edition. This file and the env defaults are the
// only places the two products are allowed to differ.
export const metadata: Metadata = {
  title: "Velocare Pharmacy Server",
  description: "Hospital pharmacy ERP",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f6f7f9" }}>{children}</body>
    </html>
  );
}
