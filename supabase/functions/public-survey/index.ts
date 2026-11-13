// public-survey: load and submit a survey by token, without login. One response per link; links expire.
//   GET  ?token=...            POST { token, answers: [{question_id, rating?, choice?, bool_value?, text_value?}] }
import { adminClient } from "../_shared/admin.ts";
import { errorResponse, json, preflight } from "../_shared/cors.ts";

const TOKEN = /^[a-f0-9]{24,64}$/;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const admin = adminClient();
  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    if (!TOKEN.test(token)) return errorResponse("Invalid link", 404);
    const { data, error } = await admin.rpc("get_public_survey", { p_token: token });
    if (error) return errorResponse(error.message, 500);
    return json(data);
  }
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({})) as { token?: string; answers?: unknown[] };
    if (!TOKEN.test(body.token ?? "") || !Array.isArray(body.answers)) return errorResponse("Invalid request");
    const { data, error } = await admin.rpc("submit_survey_response", { p_token: body.token, p_answers: body.answers.slice(0, 50) });
    if (error) return errorResponse(error.message, 400);
    return json(data);
  }
  return errorResponse("Method not allowed", 405);
});
