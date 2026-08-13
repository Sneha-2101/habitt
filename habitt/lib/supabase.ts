import { createClient } from "@supabase/supabase-js";

/** Server-side admin client with service role key for image uploads */
export function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

/** Public browser-safe client using publishable key */
export function getSupabaseBrowser() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set in .env");
  }

  return createClient(supabaseUrl, publishableKey);
}
