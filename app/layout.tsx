import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sudoku Studio | DeGolyer ES",
  description: "A little focus. A big discovery. Personalized Sudoku adventures, student records, rewards, and classroom insights for DeGolyer ES.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
