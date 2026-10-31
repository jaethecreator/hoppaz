import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EVENTS_R1 } from "@/lib/events-r1/flags";
import NotificationSettings from "./NotificationSettings";

export const metadata: Metadata = { title: "Email settings" };

/** Email settings: reminders and Pops on or off. Part of Release 1, so it is not there while NEXT_PUBLIC_EVENTS_R1 is off. */
export default function NotificationsPage() {
  if (!EVENTS_R1) notFound();
  return <NotificationSettings />;
}
