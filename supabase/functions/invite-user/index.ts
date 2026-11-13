// invite-user: Super Admin only. Invites a user by email, then assigns roles and zones.
// POST { action: "invite", email, full_name, phone?, roles: string[], zone_ids?: string[] }
// POST { action: "update", profile_id, roles, zone_ids }      POST { action: "deactivate" | "reactivate", profile_id }
import { adminClient } from "../_shared/admin.ts";
import { errorResponse, json, preflight } from "../_shared/cors.ts";
import { getCaller, hasRole } from "../_shared/auth.ts";
import { normalizePhone } from "../_shared/render.ts";

const ROLES = ["super_admin", "manager", "ops_officer", "sales_exec", "zonal_officer", "accountant", "fleet_manager", "driver", "executive"];

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
