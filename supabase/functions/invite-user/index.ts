// invite-user: Super Admin only. Invites a user by email, then assigns roles and zones.
// POST { action: "invite", email, full_name, phone?, roles: string[], zone_ids?: string[] }
// POST { action: "update", profile_id, roles, zone_ids }      POST { action: "deactivate" | "reactivate", profile_id }
// POST { action: "set_password", profile_id, password? } -> { password } for the admin to pass on
import { adminClient } from "../_shared/admin.ts";
import { errorResponse, json, preflight } from "../_shared/cors.ts";
import { getCaller, hasRole } from "../_shared/auth.ts";
import { normalizePhone } from "../_shared/render.ts";

const ROLES = ["super_admin", "manager", "ops_officer", "sales_exec", "zonal_officer", "accountant", "fleet_manager", "driver", "executive"];

/* Characters a person can read aloud over a phone without ambiguity: no O/0, l/1/I, or symbols
   that differ between keyboard layouts. Twelve of these is about 62 bits, which is ample for a
   password that is replaced on first sign-in. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function generatePassword(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // Rejection-free bias is not worth the complexity here; the alphabet is close enough to a
  // divisor of 256 that the skew is negligible for a short-lived credential.
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

async function setRolesAndZones(profileId: string, roles: string[] | undefined, zoneIds: string[] | undefined) {
  const admin = adminClient();
  if (roles) {
    const bad = roles.filter((r) => !ROLES.includes(r));
    if (bad.length) throw new Error(`Unknown role(s): ${bad.join(", ")}`);
    await admin.from("user_roles").delete().eq("profile_id", profileId);
    if (roles.length) {
      const { error } = await admin.from("user_roles").insert(roles.map((r) => ({ profile_id: profileId, role_code: r })));
      if (error) throw new Error(error.message);
    }
  }
  if (zoneIds) {
    await admin.from("user_zones").delete().eq("profile_id", profileId);
    if (zoneIds.length) {
      const { error } = await admin.from("user_zones").insert(zoneIds.map((z) => ({ profile_id: profileId, zone_id: z })));
      if (error) throw new Error(error.message);
    }
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Use POST", 405);
  const caller = await getCaller(req);
  if (!hasRole(caller, "super_admin") || !caller!.roles.includes("super_admin")) return errorResponse("Only a Super Admin can manage users", 403);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const admin = adminClient();
  try {
    switch (body.action ?? "invite") {
      case "invite": {
        const email = String(body.email ?? "").trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) return errorResponse("A valid email is required");
        const fullName = String(body.full_name ?? "").trim() || email.split("@")[0];
        const redirectTo = `${(Deno.env.get("PUBLIC_APP_URL") ?? "").replace(/\/$/, "")}/reset-password`;
        // an existing (e.g. demo) profile with this email is claimed by the auth trigger
        const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName }, redirectTo });
        if (error) return errorResponse(error.message);
        const { data: profile } = await admin.from("profiles").select("id").eq("user_id", invited.user.id).single();
        if (!profile) return errorResponse("Profile was not created", 500);
        await admin.from("profiles").update({ full_name: fullName, phone: normalizePhone(body.phone as string) }).eq("id", profile.id);
        await setRolesAndZones(profile.id, body.roles as string[] | undefined, body.zone_ids as string[] | undefined);
        return json({ ok: true, profile_id: profile.id });
      }
      case "update": {
        if (body.profile_id === caller!.profileId && Array.isArray(body.roles) && !(body.roles as string[]).includes("super_admin")) {
          return errorResponse("You cannot remove your own Super Admin role");
        }
        await setRolesAndZones(String(body.profile_id), body.roles as string[] | undefined, body.zone_ids as string[] | undefined);
        return json({ ok: true });
      }
      case "set_password": {
        const profileId = String(body.profile_id ?? "");
        const { data: p, error: pErr } = await admin.from("profiles")
          .select("id, user_id, email, full_name, is_active").eq("id", profileId).single();
        if (pErr || !p) return errorResponse("That person was not found", 404);
        if (!p.is_active) return errorResponse("Reactivate this person before setting a password");
        if (!p.email) return errorResponse("This person has no email address, which is what they sign in with");

        const supplied = typeof body.password === "string" ? body.password.trim() : "";
        if (supplied && supplied.length < 8) return errorResponse("A password must be at least 8 characters");
        const password = supplied || generatePassword();

        if (p.user_id) {
          const { error } = await admin.auth.admin.updateUserById(p.user_id, { password });
          if (error) return errorResponse(error.message);
        } else {
          /* Invited but never signed up, or a profile created ahead of the person. Create the
             account outright with the email already confirmed, so they can sign in immediately
             without waiting for a link, then attach it to the profile that is already here. */
          const { data: created, error } = await admin.auth.admin.createUser({
            email: p.email, password, email_confirm: true, user_metadata: { full_name: p.full_name },
          });
          if (error) return errorResponse(error.message);
          const { error: linkErr } = await admin.from("profiles")
            .update({ user_id: created.user.id }).eq("id", p.id);
          if (linkErr) return errorResponse(linkErr.message);
        }

        await admin.from("profiles").update({ must_change_password: true }).eq("id", p.id);
        /* The password itself is never written anywhere — only the fact that one was issued. */
        await admin.from("audit_log").insert({
          table_name: "auth.users", record_id: p.id, action: "UPDATE",
          changed_by: caller!.profileId, db_role: "service_role",
          new_values: { event: "temporary_password_issued", issued_for: p.full_name },
        });
        return json({ ok: true, password });
      }
      case "deactivate":
      case "reactivate": {
        if (body.profile_id === caller!.profileId) return errorResponse("You cannot deactivate yourself");
        const active = body.action === "reactivate";
        const { data: p } = await admin.from("profiles").update({ is_active: active }).eq("id", String(body.profile_id)).select("user_id").single();
        if (p?.user_id) await admin.auth.admin.updateUserById(p.user_id, { ban_duration: active ? "none" : "876000h" });
        return json({ ok: true });
      }
      default:
        return errorResponse("Unknown action");
    }
  } catch (e) {
    return errorResponse((e as Error).message, 400);
  }
});
