"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { setAppNavigator } from "@/lib/appNav";

/** Mount once, before the page in the layout: gives lib/appNav the router, so in-app moves made from plain code never reload. */
export default function AppNavigator() {
  const router = useRouter();
  useEffect(() => setAppNavigator((href, replace) => (replace ? router.replace(href) : router.push(href))), [router]);
  return null;
}
