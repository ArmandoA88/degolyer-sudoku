import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DeGolyer ES Sudoku Studio | Dallas ISD",
  description: "Sudoku for the DeGolyer ES Dolphins in Dallas ISD. Student puzzles, personal records, rewards, and a protected teacher classroom dashboard.",
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
