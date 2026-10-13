import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export function getQueerServerClients(bearer: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !publishable || !secret || !bearer) return null;
  const auth = createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return { auth, admin };
}

export async function getPermanentUser(auth: SupabaseClient<any, "public", "public", any, any>): Promise<User | null> {
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user || data.user.is_anonymous || !data.user.email) return null;
  return data.user;
}

export const bearerFrom = (request: Request) =>
  (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
