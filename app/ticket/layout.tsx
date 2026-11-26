import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support Ticket",
  robots: { index: false, follow: false },
};

export default function TicketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
