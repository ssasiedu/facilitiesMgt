// Resolve the signed-in caller (from the Authorization header) to a profile and roles.
import { adminClient } from "./admin.ts";

export interface Caller {
  userId: string;
  profileId: string;
  email: string | null;
  roles: string[];
}

export async function getCaller(req: Request): Promise<Caller | null> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await admin.from("profiles").select("id, email, is_active").eq("user_id", data.user.id).maybeSingle();
  if (!profile || !profile.is_active) return null;
  const { data: roles } = await admin.from("user_roles").select("role_code").eq("profile_id", profile.id);
  return { userId: data.user.id, profileId: profile.id, email: profile.email, roles: (roles ?? []).map((r: { role_code: string }) => r.role_code) };
}

export function hasRole(caller: Caller | null, ...roles: string[]): boolean {
  if (!caller) return false;
  return caller.roles.includes("super_admin") || roles.some((r) => caller.roles.includes(r));
}

/** Constant-time comparison for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
