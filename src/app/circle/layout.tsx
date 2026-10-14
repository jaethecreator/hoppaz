import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Private space · Hoppaz",
  robots: { index: false, follow: false },
};

export default function CircleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
