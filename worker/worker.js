import {decodeSnapshot} from './snapshot-codec.mjs';
import {attachVisibility,canonicalUsers,scopeSnapshot,mergeScopedWrite,allowedStaffRoute,handleUsers,isPrimaryOwner} from './user-access.mjs';
import {handleAuditConnectors} from './audit-connectors.mjs';
import {handleAudits,enqueueDemoAudits,mergeAuditDocuments,resumeAuditQueue} from './audits.mjs';
import {handleCallQueue} from './call-queue.mjs';
import {handleContactArchive} from './contact-archive.mjs';
import {handleSalesContactAutosave} from './sales-contact-autosave.mjs';
import {snapshotEtag,checkSnapshotRevision,writeSnapshot} from './snapshot-store.mjs';
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
function json(e, r = 200, t = {}) {
  return new Response(JSON.stringify(e), { status: r, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...t } });
}
__name(json, "json");
__name2(json, "json");
function errorResponse(e, r = 400, t = {}) {
  return json({ error: e, ...t }, r);
}
__name(errorResponse, "errorResponse");
__name2(errorResponse, "errorResponse");
function b64urlToUint8Array(e) {
  const r = e.replace(/-/g, "+").replace(/_/g, "/"), t = r + "===".slice((r.length + 3) % 4), s = atob(t), o = new Uint8Array(s.length);
  for (let e2 = 0; e2 < s.length; e2++) o[e2] = s.charCodeAt(e2);
  return o;
}
__name(b64urlToUint8Array, "b64urlToUint8Array");
__name2(b64urlToUint8Array, "b64urlToUint8Array");
function b64urlToJson(e) {
  const r = b64urlToUint8Array(e), t = new TextDecoder().decode(r);
  return JSON.parse(t);
}
__name(b64urlToJson, "b64urlToJson");
__name2(b64urlToJson, "b64urlToJson");
function genId(e) {
  return `${e}_${crypto.randomUUID().replace(/-/g, "")}`;
}
__name(genId, "genId");
__name2(genId, "genId");
var jwksCache = { keys: null, fetchedAt: 0 };
async function getJwks(e) {
  if (jwksCache.keys && Date.now() - jwksCache.fetchedAt < 36e5) return jwksCache.keys;
  const r = `https://${e.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, t = await fetch(r);
  if (!t.ok) throw new Error(`Failed to fetch Access JWKS: ${t.status}`);
  const s = await t.json();
  return jwksCache.keys = s.keys || [], jwksCache.fetchedAt = Date.now(), jwksCache.keys;
}
__name(getJwks, "getJwks");
__name2(getJwks, "getJwks");
async function importJwk(e) {
  return crypto.subtle.importKey("jwk", e, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}
__name(importJwk, "importJwk");
__name2(importJwk, "importJwk");
async function verifyAccessJwt(e, r) {
  const t = e.headers.get("Cf-Access-Jwt-Assertion");
  if (!t) return { ok: false, status: 401, error: "Missing Cf-Access-Jwt-Assertion header" };
  const s = t.split(".");
  if (3 !== s.length) return { ok: false, status: 401, error: "Malformed Access JWT" };
  const [o, n, a] = s;
  let i, d;
  try {
    i = b64urlToJson(o), d = b64urlToJson(n);
  } catch (e2) {
    return { ok: false, status: 401, error: "Unable to parse Access JWT" };
  }
  const c = Math.floor(Date.now() / 1e3);
  if ("number" == typeof d.exp && c >= d.exp) return { ok: false, status: 401, error: "Access JWT expired" };
  if ("number" == typeof d.nbf && c < d.nbf) return { ok: false, status: 401, error: "Access JWT not yet valid" };
  const u = Array.isArray(d.aud) ? d.aud : [d.aud], l = (r.ACCESS_AUD || "").split(",").map((e2) => e2.trim()).filter(Boolean);
  if (!u.some((e2) => l.includes(e2))) return { ok: false, status: 401, error: "Access JWT audience mismatch" };
  let p;
  try {
    p = await getJwks(r);
  } catch (e2) {
    return { ok: false, status: 503, error: "Unable to fetch Access JWKS" };
  }
  const w = p.find((e2) => e2.kid === i.kid);
  if (!w) return { ok: false, status: 401, error: "Unknown Access signing key" };
  let _;
  try {
    _ = await importJwk(w);
  } catch (e2) {
    return { ok: false, status: 500, error: "Failed to import Access signing key" };
  }
  const h = new TextEncoder().encode(`${o}.${n}`), f = b64urlToUint8Array(a);
  let m = false;
  try {
    m = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", _, f, h);
  } catch (e2) {
    m = false;
  }
  if (!m) return { ok: false, status: 401, error: "Access JWT signature invalid" };
  const y = (d.email || "").toLowerCase().trim();
  return y ? { ok: true, email: y, payload: d } : { ok: false, status: 401, error: "Access JWT missing email claim" };
}
__name(verifyAccessJwt, "verifyAccessJwt");
__name2(verifyAccessJwt, "verifyAccessJwt");
async function resolveUser(e, r) {
  const t = await e.DB.prepare("SELECT u.id, u.org_id, u.email, u.name, u.role_id, u.status,\n            r.code AS role_code, r.name AS role_name\n     FROM users u\n     JOIN roles r ON r.id = u.role_id\n     WHERE u.email = ? AND u.deleted_at IS NULL").bind(r).first();
  if (!t) return null;
  if ("active" !== t.status) return null;
  const s = await e.DB.prepare("SELECT p.code FROM role_permissions rp\n     JOIN permissions p ON p.id = rp.permission_id\n     WHERE rp.role_id = ?").bind(t.role_id).all(), o = new Set((s.results || []).map((e2) => e2.code));
  return attachVisibility(e,{ id: t.id, orgId: t.org_id, email: t.email, name: t.name, roleId: t.role_id, roleCode: t.role_code, roleName: t.role_name, permissions: o, isOwner: "owner_admin" === t.role_code });
}
__name(resolveUser, "resolveUser");
__name2(resolveUser, "resolveUser");
function hasPerm(e, r) {
  return e.isOwner || e.permissions.has(r);
}
__name(hasPerm, "hasPerm");
__name2(hasPerm, "hasPerm");
var RESOURCES = { contacts: { table: "contacts", writable: ["name", "brokerage", "state", "timezone", "status", "email", "phone", "services", "lead_source", "transactions_per_year", "monthly_override", "rate_locked_until", "notice_days", "week_one_target", "drive_folder_url", "consent_given_at", "consent_source", "consent_withdrawn_at", "work_start", "work_end", "owner_user_id", "notes", "onboarding_nda", "onboarding_vault", "onboarding_access_log", "compliance_verified_at"], viewPerm: "perm_clients_view", writePerm: null }, deals: { table: "deals", writable: ["contact_id", "stage", "meeting_at", "prep_due_at", "artifact_type", "artifact_minutes", "scope_agreed", "no_show_count", "next_action_at", "lost_reason", "checks", "stage_at"], viewPerm: "perm_sales_view", writePerm: "perm_sales_edit" }, tickets: { table: "tickets", writable: ["contact_id", "title", "type", "status", "module", "channel", "owner_user_id", "assignee_user_id", "status_at", "minutes", "body", "closed_at"], viewPerm: "perm_tickets_view", writePerm: null }, work_items: { table: "work_items", writable: ["contact_id", "ticket_id", "title", "module", "source", "status", "assignee_user_id", "due_at", "minutes", "runs_outside_plan", "completion_note", "op_status", "sop_instance_id", "sop_step_id", "sop_phase", "evidence_required", "social_post_id"], viewPerm: "perm_work_view_own", writePerm: "perm_work_view_own", ownFilterColumn: "assignee_user_id" }, reminders: { table: "reminders", writable: ["contact_id", "kind", "title", "at", "done", "assignee_user_id"], viewPerm: "perm_work_view_own", writePerm: "perm_work_view_own", ownFilterColumn: "assignee_user_id" }, meetings: { table: "meetings", writable: ["contact_id", "kind", "at", "source", "notes"], viewPerm: "perm_clients_view", writePerm: null }, calls: { table: "calls", writable: ["contact_id", "at", "outcome", "note", "by_user_id", "queue"], viewPerm: "perm_calls_view", writePerm: null, noUpdatedAt: true, noDeletedAt: true }, notes: { table: "notes", writable: ["entity_type", "entity_id", "body", "url", "by_user_id", "edited_at"], viewPerm: "perm_clients_view", writePerm: null, noCreatedAt: true, createdAtCol: "at", noUpdatedAt: true }, social_posts: { table: "social_posts", writable: ["contact_id", "account_id", "platform", "format", "preset", "objective", "title", "caption", "audience_tz", "scheduled_at", "assignee_user_id", "approval_required", "status", "published_at"], viewPerm: "perm_social_view", writePerm: null }, activity_log: { table: "activity_log", writable: [], viewPerm: "perm_activity_view", writePerm: null, readOnly: true, noCreatedAt: true, createdAtCol: "at", noUpdatedAt: true, noDeletedAt: true } };
function isoNow() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(isoNow, "isoNow");
__name2(isoNow, "isoNow");
async function logActivity(e, r, t, s, o, n) {
  try {
    const a = `${t}:${s}${o ? `:${o}` : ""}`;
    await e.DB.prepare("INSERT INTO activity_log (id, org_id, who_user_id, what, contact_id) VALUES (?, ?, ?, ?, ?)").bind(genId("act"), r.orgId, r.id, a, n || null).run();
  } catch (e2) {
    console.error("activity_log insert failed", e2.message);
  }
}
__name(logActivity, "logActivity");
__name2(logActivity, "logActivity");
async function handleResourceRequest(e, r, t, s, o) {
  const n = RESOURCES[s];
  if (!n) return errorResponse("Unknown resource", 404);
  const a = e.method, i = !n.noDeletedAt, d = !n.noUpdatedAt, c = n.createdAtCol || "created_at";
  if ("GET" === a) {
    if (!hasPerm(t, n.viewPerm)) return errorResponse("Forbidden", 403);
    let e2 = `SELECT * FROM ${n.table}`;
    const a2 = [], d2 = [], u = "work_items" === s ? "wi.org_id" : "org_id";
    if (a2.push(`${u} = ?`), d2.push(t.orgId), i && a2.push(("work_items" === s ? "wi." : "") + "deleted_at IS NULL"), !t.isOwner && n.ownFilterColumn && ("work_items" === s ? (e2 = "SELECT wi.* FROM work_items wi JOIN work_assignments wa ON wa.work_item_id = wi.id", a2.push("wa.user_id = ?"), d2.push(t.id)) : (a2.push(`${n.ownFilterColumn} = ?`), d2.push(t.id))), o) {
      a2.push("work_items" === s ? "wi.id = ?" : "id = ?"), d2.push(o);
      const t2 = a2.length ? `${e2} WHERE ${a2.join(" AND ")}` : e2, n2 = await r.DB.prepare(t2).bind(...d2).first();
      return n2 ? json({ data: n2 }) : errorResponse("Not found", 404);
    }
    let l = a2.length ? `${e2} WHERE ${a2.join(" AND ")}` : e2;
    l += ` ORDER BY ${"work_items" === s ? "wi." + c : c} DESC LIMIT 200`;
    return json({ data: (await r.DB.prepare(l).bind(...d2).all()).results || [] });
  }
  if (n.readOnly) return errorResponse("Read-only resource", 405);
  if ("POST" === a) {
    if (!hasPerm(t, n.writePerm)) return errorResponse("Forbidden", 403);
    let o2;
    try {
      o2 = await e.json();
    } catch (e2) {
      return errorResponse("Invalid JSON body", 400);
    }
    const a2 = genId(s.slice(0, 4)), i2 = ["id", "org_id"], d2 = [a2, t.orgId];
    for (const e2 of n.writable) Object.prototype.hasOwnProperty.call(o2, e2) && (i2.push(e2), d2.push(o2[e2]));
    const c2 = i2.map(() => "?").join(", ");
    try {
      await r.DB.prepare(`INSERT INTO ${n.table} (${i2.join(", ")}) VALUES (${c2})`).bind(...d2).run();
    } catch (e2) {
      return errorResponse(`Insert failed: ${e2.message}`, 400);
    }
    await logActivity(r, t, "create", s, a2, o2.contact_id);
    return json({ data: await r.DB.prepare(`SELECT * FROM ${n.table} WHERE id = ?`).bind(a2).first() }, 201);
  }
  if ("PATCH" === a || "PUT" === a) {
    if (!hasPerm(t, n.writePerm)) return errorResponse("Forbidden", 403);
    if (!o) return errorResponse("Missing id", 400);
    if(!await r.DB.prepare(`SELECT id FROM ${n.table} WHERE org_id = ? AND id = ?${i?' AND deleted_at IS NULL':''}`).bind(t.orgId,o).first())return errorResponse('Not found',404);
    if (!t.isOwner && n.ownFilterColumn) if ("work_items" === s) {
      if (!await r.DB.prepare("SELECT 1 FROM work_assignments WHERE work_item_id = ? AND user_id = ?").bind(o, t.id).first()) return errorResponse("Forbidden", 403);
    } else {
      const e2 = await r.DB.prepare(`SELECT ${n.ownFilterColumn} AS owner FROM ${n.table} WHERE id = ?`).bind(o).first();
      if (!e2 || e2.owner !== t.id) return errorResponse("Forbidden", 403);
    }
    let a2;
    try {
      a2 = await e.json();
    } catch (e2) {
      return errorResponse("Invalid JSON body", 400);
    }
    const i2 = [], c2 = [];
    for (const e2 of n.writable) Object.prototype.hasOwnProperty.call(a2, e2) && (i2.push(`${e2} = ?`), c2.push(a2[e2]));
    if (0 === i2.length) return errorResponse("No writable fields provided", 400);
    d && (i2.push("updated_at = ?"), c2.push(isoNow())), c2.push(t.orgId,o);
    try {
      await r.DB.prepare(`UPDATE ${n.table} SET ${i2.join(", ")} WHERE org_id = ? AND id = ?`).bind(...c2).run();
    } catch (e2) {
      return errorResponse(`Update failed: ${e2.message}`, 400);
    }
    await logActivity(r, t, "update", s, o, a2.contact_id);
    const u = await r.DB.prepare(`SELECT * FROM ${n.table} WHERE org_id = ? AND id = ?`).bind(t.orgId,o).first();
    return u ? json({ data: u }) : errorResponse("Not found", 404);
  }
  if ("DELETE" === a) {
    if (!t.isOwner) return errorResponse("Forbidden: only Owner/Admin can delete", 403);
    if (!o) return errorResponse("Missing id", 400);
    if (!i) return errorResponse("This resource does not support deletion via the API", 405);
    if(!await r.DB.prepare(`SELECT id FROM ${n.table} WHERE org_id = ? AND id = ? AND deleted_at IS NULL`).bind(t.orgId,o).first())return errorResponse('Not found',404);
    try {
      await r.DB.prepare(`UPDATE ${n.table} SET deleted_at = ? WHERE org_id = ? AND id = ?`).bind(isoNow(),t.orgId,o).run();
    } catch (e2) {
      return errorResponse(`Delete failed: ${e2.message}`, 400);
    }
    return await logActivity(r, t, "delete", s, o, null), json({ data: { id: o, deleted: true } });
  }
  return errorResponse("Method not allowed", 405);
}
__name(handleResourceRequest, "handleResourceRequest");
__name2(handleResourceRequest, "handleResourceRequest");
function bytesToB64(e) {
  let r = "";
  for (let t = 0; t < e.length; t++) r += String.fromCharCode(e[t]);
  return btoa(r);
}
__name(bytesToB64, "bytesToB64");
__name2(bytesToB64, "bytesToB64");
function b64ToBytes(e) {
  const r = atob(e), t = new Uint8Array(r.length);
  for (let e2 = 0; e2 < r.length; e2++) t[e2] = r.charCodeAt(e2);
  return t;
}
__name(b64ToBytes, "b64ToBytes");
__name2(b64ToBytes, "b64ToBytes");
async function pbkdf2Hash(e, r, t) {
  const s = new TextEncoder(), o = await crypto.subtle.importKey("raw", s.encode(e), { name: "PBKDF2" }, false, ["deriveBits"]), n = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: r, iterations: t, hash: "SHA-256" }, o, 256);
  return new Uint8Array(n);
}
__name(pbkdf2Hash, "pbkdf2Hash");
__name2(pbkdf2Hash, "pbkdf2Hash");
async function hashPassword(e) {
  const r = crypto.getRandomValues(new Uint8Array(16)), t = await pbkdf2Hash(e, r, 1e5);
  return `100000:${bytesToB64(r)}:${bytesToB64(t)}`;
}
__name(hashPassword, "hashPassword");
__name2(hashPassword, "hashPassword");
function timingSafeEqual(e, r) {
  if (e.length !== r.length) return false;
  let t = 0;
  for (let s = 0; s < e.length; s++) t |= e[s] ^ r[s];
  return 0 === t;
}
__name(timingSafeEqual, "timingSafeEqual");
__name2(timingSafeEqual, "timingSafeEqual");
async function verifyPassword(e, r) {
  if (!r) return false;
  const t = r.split(":");
  if (3 !== t.length) return false;
  const [s, o, n] = t, a = parseInt(s, 10);
  if (!Number.isFinite(a) || a <= 0) return false;
  const i = b64ToBytes(o), d = b64ToBytes(n);
  return timingSafeEqual(await pbkdf2Hash(e, i, a), d);
}
__name(verifyPassword, "verifyPassword");
__name2(verifyPassword, "verifyPassword");
async function handleAuthRequest(e, r, t, s) {
  if ("POST" !== e.method) return errorResponse("Method not allowed", 405);
  let o;
  try {
    o = await e.json();
  } catch (e2) {
    return errorResponse("Invalid JSON body", 400);
  }
  if ("set-password" === s) {
    const { password: e2, currentPassword: s2 } = o;
    if ("string" != typeof e2 || e2.length < 10) return errorResponse("Password must be at least 10 characters", 400);
    const n = await r.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(t.id).first();
    if (n && n.password_hash && ("string" != typeof s2 || !await verifyPassword(s2, n.password_hash))) return errorResponse("Current password is incorrect", 403);
    const a = await hashPassword(e2);
    return await r.DB.prepare("UPDATE users SET password_hash = ?, password_algo = ?, password_set_at = ? WHERE id = ?").bind(a, "pbkdf2-sha256", isoNow(), t.id).run(), await logActivity(r, t, "set-password", "users", t.id, null), json({ data: { ok: true } });
  }
  if ("verify-password" === s) {
    const { password: e2 } = o;
    if ("string" != typeof e2) return errorResponse("Missing password", 400);
    const s2 = await r.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(t.id).first();
    if (!s2 || !s2.password_hash) return json({ data: { valid: false, reason: "no_password_set" } });
    return json({ data: { valid: await verifyPassword(e2, s2.password_hash) } });
  }
  if ("admin-set-password" === s) {
    if (!t.isOwner) return errorResponse("Forbidden: only Owner/Admin can reset other users' passwords", 403);
    const { userId: e2, password: s2 } = o;
    if ("string" != typeof e2 || "string" != typeof s2 || s2.length < 10) return errorResponse("userId and a password of at least 10 characters are required", 400);
    if(e2===(r.CRM_OWNER_USER_ID||'u_ibrar')&&!isPrimaryOwner(t,r))return errorResponse("Only Ibrar can change the primary owner’s password.",403);
    if (!await r.DB.prepare("SELECT id FROM users WHERE id = ? AND org_id = ? AND deleted_at IS NULL").bind(e2,t.orgId).first()) return errorResponse("User not found", 404);
    const n = await hashPassword(s2);
    return await r.DB.prepare("UPDATE users SET password_hash = ?, password_algo = ?, password_set_at = ? WHERE id = ? AND org_id = ?").bind(n, "pbkdf2-sha256", isoNow(), e2,t.orgId).run(), await logActivity(r, t, "admin-set-password", "users", e2, null), json({ data: { ok: true } });
  }
  return errorResponse("Unknown auth action", 404);
}
__name(handleAuthRequest, "handleAuthRequest");
__name2(handleAuthRequest, "handleAuthRequest");
function meResponse(e, r) {
  return json({ id: e.id, email: e.email, name: e.name, role: e.roleCode, roleName: e.roleName, isOwner: e.isOwner, isPrimaryOwner:e.isPrimaryOwner===true, permissions: Array.from(e.permissions), visibility:e.visibility, hasPasswordSet: !!r });
}
__name(meResponse, "meResponse");
__name2(meResponse, "meResponse");
function mergeZoomMeetings(existingMeetings, zoomRows) {
  const list = Array.isArray(existingMeetings) ? existingMeetings : [];
  const nonZoom = list.filter(function(m) {
    return !(m && m.zoom_meeting_id);
  });
  const merged = zoomRows.map(function(row) {
    return {
      id: row.id,
      kind: null,
      attendees: [],
      zoom_meeting_id: row.zoom_meeting_id,
      zoom_uuid: row.zoom_uuid,
      zoom_topic: row.zoom_topic,
      zoom_host: row.zoom_host,
      zoom_status: row.zoom_status,
      at: row.at,
      timezone: row.timezone,
      meeting_duration_seconds: row.meeting_duration_seconds,
      meeting_ended_at: row.meeting_ended_at,
      assignee: row.assignee || "Unassigned",
      matched_contact_id: row.matched_contact_id || null,
      contact_id: row.matched_contact_id || null,
      matched_deal_id: row.matched_deal_id || null,
      match_state: row.match_state || "unmatched",
      internal_notes: row.internal_notes || null,
      archived_at: row.archived_at || null,
      summary_status: row.summary_status,
      summary_source: row.summary_source,
      summary_overview: row.summary_overview,
      summary_text: row.summary_text,
      summary_details: row.summary_details ? JSON.parse(row.summary_details) : [],
      summary_next_steps: row.summary_next_steps ? JSON.parse(row.summary_next_steps) : [],
      summary_created_at: row.summary_created_at
    };
  });
  return nonZoom.concat(merged);
}
__name(mergeZoomMeetings, "mergeZoomMeetings");
__name2(mergeZoomMeetings, "mergeZoomMeetings");
async function handleDbBlobRequest(e, r, t, ctx) {
  if ("GET" === e.method) {
    const e2 = await r.DB.prepare("SELECT data, updated_at, updated_by FROM crm_snapshot WHERE org_id = ?").bind(t.orgId).first();
    if (!e2) return json({ data: null, updatedAt: null },200,{ETag:snapshotEtag(null)});
    let s;
    try {
      s = await decodeSnapshot(e2.data);
    } catch (e3) {
      return errorResponse("Stored snapshot is corrupted; contact the Owner/Admin", 500);
    }
    try {
      const zoomRows = (await r.DB.prepare("SELECT * FROM zoom_crm_meetings WHERE org_id = ?").bind(t.orgId).all()).results || [];
      if (zoomRows.length) s.meetings = mergeZoomMeetings(s.meetings, zoomRows);
    } catch (e4) {
      console.error("zoom meeting merge-on-read failed", e4.message);
    }
    try { s.files = await mergeAuditDocuments(r, t.orgId, s.files || []); } catch (err) { console.error('Audit document merge unavailable', err.message); }
    s.users=await canonicalUsers(r,t.orgId,s.users||[]);return json({ data: scopeSnapshot(s,t), updatedAt: e2.updated_at, updatedBy: e2.updated_by },200,{ETag:snapshotEtag(e2)});
  }
  if ("PUT" === e.method) {
    let s;
    try {
      s = await e.json();
    } catch (e2) {
      return errorResponse("Invalid JSON body", 400);
    }
    if (null === s || "object" != typeof s || Array.isArray(s)) return errorResponse("Body must be a JSON object (the whole db)", 400);
    // zoom_crm_meetings is the sole authoritative owner of a Zoom meeting's
    // entire record (see mergeZoomMeetings). A client's snapshot always
    // reflects whatever GET last merged in, so without this filter a
    // routine autosave would copy that merged data straight back into
    // crm_snapshot -- exactly the dual-ownership/stale-copy problem this
    // architecture exists to prevent. Any meeting the client is trying to
    // save that carries a zoom_meeting_id is dropped here unconditionally;
    // legitimate edits to a Zoom meeting go through /api/zoom/meetings/:id
    // instead, which writes zoom_crm_meetings directly.
    if (Array.isArray(s.meetings)) {
      s.meetings = s.meetings.filter(function(m) { return !(m && m.zoom_meeting_id); });
    }
    // Generated audit documents are owned by audit_reports, not snapshot autosaves.
    if (Array.isArray(s.files)) s.files = s.files.filter(f=>!f.audit_report_id);
    const previous = await r.DB.prepare('SELECT data,updated_at FROM crm_snapshot WHERE org_id=?').bind(t.orgId).first();
    const revisionError=checkSnapshotRevision(e,previous);
    if(revisionError)return errorResponse(revisionError.error,revisionError.status,{updatedAt:revisionError.updatedAt});
    let before;
    try{before=previous?await decodeSnapshot(previous.data):{contacts:[],deals:[]};}catch{return errorResponse('Stored snapshot is corrupted; contact Ibrar.',500);}
    // The roster can change through /api/users without a snapshot save. Use
    // current trusted identities for scoped write validation, as GET does.
    before.users=await canonicalUsers(r,t.orgId,before.users||[]);
    try{s=mergeScopedWrite(before,s,t);}catch(err){return errorResponse(err.message,403);}
    s.users=await canonicalUsers(r,t.orgId,before.users||[]);
    const o = JSON.stringify(s);
    if (new TextEncoder().encode(o).length > 8388608) return errorResponse("Snapshot too large", 413);
    let n;try{n=await writeSnapshot(r,t.orgId,o,t.id,previous);}catch(err){if(err.code==='SNAPSHOT_TOO_LARGE')return errorResponse(err.message,413);throw err;}
    if(!n)return errorResponse('This workspace changed while saving. Reload before saving to keep everyone’s updates.',409);
    await logActivity(r, t, 'save-snapshot', 'crm_snapshot', t.orgId, null);
    // Queue only a newly opened demo deal or a transition into Demo scheduled.
    // The unique org/deal key prevents duplicate generation and spending.
    try { await enqueueDemoAudits(r, t, before, s, ctx); } catch (err) { console.error('Audit queue unavailable', err.message); }
    return json({ data: { ok: true, updatedAt: n },...(!t.isOwner?{snapshot:scopeSnapshot(s,t)}:{}) },200,{ETag:JSON.stringify(n)});
  }
  return errorResponse("Method not allowed", 405);
}
__name(handleDbBlobRequest, "handleDbBlobRequest");
__name2(handleDbBlobRequest, "handleDbBlobRequest");
var ALLOWED_ORIGINS = /* @__PURE__ */ new Set(["https://crm.sereneop.com", "https://zoom-zoho-integration.serene-ops-crm.pages.dev"]);
function corsHeaders(e) {
  const r = e.headers.get("Origin");
  return r && ALLOWED_ORIGINS.has(r) ? { "Access-Control-Allow-Origin": r, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type, Cf-Access-Jwt-Assertion, X-Requested-With, If-Match", "Access-Control-Expose-Headers": "ETag", "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS", Vary: "Origin" } : {};
}
__name(corsHeaders, "corsHeaders");
__name2(corsHeaders, "corsHeaders");
function withCors(e, r) {
  const t = corsHeaders(r);
  for (const [r2, s] of Object.entries(t)) e.headers.set(r2, s);
  return e;
}
__name(withCors, "withCors");
__name2(withCors, "withCors");
var BACKUP_TABLES = ["crm_daily_usage", "call_reservations", "user_invitations", "user_invitation_locks", "user_visibility", "audit_cases", "audit_reports", "audit_connector_runs", "access_records", "activity_log", "audit_log", "automation_rules", "automation_runs", "business_tasks", "calls", "client_commercial", "client_scope", "client_services", "clients", "compliance_jurisdictions", "compliance_overlays", "compliance_reviews", "compliance_rules", "compliance_sources", "contacts", "crm_snapshot", "deal_stage_history", "deals", "files", "meetings", "notes", "organizations", "permissions", "reminders", "reports", "role_permissions", "roles", "scope_usage", "sessions", "social_accounts", "social_performance", "social_posts", "social_schedule", "sop_approvals", "sop_evidence", "sop_instance_steps", "sop_instances", "sop_sources", "sop_steps", "sop_template_sources", "sop_template_versions", "sop_templates", "ticket_history", "tickets", "users", "work_assignments", "work_history", "work_items", "work_time_logs"];
var BACKUP_RETENTION_DAYS = 45;
async function runNightlyBackup(env) {
  const dump = {};
  const errors = {};
  for (const table of BACKUP_TABLES) {
    try {
      const result = await env.DB.prepare("SELECT * FROM " + table).all();
      let rows = result.results || [];
      if (table === "users") {
        rows = rows.map(function(r) {
          const copy = Object.assign({}, r);
          delete copy.password_hash;
          return copy;
        });
      }
      dump[table] = rows;
    } catch (e) {
      errors[table] = e.message;
    }
  }
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const payload = { backedUpAt: timestamp, tableCount: Object.keys(dump).length, rowCounts: Object.fromEntries(Object.entries(dump).map(function(pair) {
    return [pair[0], pair[1].length];
  })), errors: Object.keys(errors).length ? errors : void 0, tables: dump };
  const key = "backups/" + timestamp.replace(/[:.]/g, "-") + ".json";
  const body = JSON.stringify(payload);
  await env.FILES.put(key, body, { httpMetadata: { contentType: "application/json" } });
  await pruneOldBackups(env, timestamp);
  return { key, bytes: body.length, tableCount: payload.tableCount, errors };
}
__name(runNightlyBackup, "runNightlyBackup");
__name2(runNightlyBackup, "runNightlyBackup");
async function pruneOldBackups(env, nowIso) {
  try {
    const cutoff = new Date(Date.parse(nowIso) - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1e3);
    const cutoffKeyFragment = cutoff.toISOString().replace(/[:.]/g, "-");
    const listed = await env.FILES.list({ prefix: "backups/" });
    for (const obj of listed.objects || []) {
      const stamp = obj.key.slice("backups/".length);
      if (stamp < cutoffKeyFragment) {
        await env.FILES.delete(obj.key);
      }
    }
  } catch (e) {
    console.error("backup prune failed", e.message);
  }
}
__name(pruneOldBackups, "pruneOldBackups");
__name2(pruneOldBackups, "pruneOldBackups");
function nextMonthlyRenewal(rateLockedUntil, today) {
  const anchor = /* @__PURE__ */ new Date(rateLockedUntil + "T00:00:00Z");
  if (isNaN(anchor.getTime())) return null;
  const next = new Date(anchor.getTime());
  while (next.getTime() < today.getTime()) {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next;
}
__name(nextMonthlyRenewal, "nextMonthlyRenewal");
__name2(nextMonthlyRenewal, "nextMonthlyRenewal");
async function runContractDeadlineCheck(env) {
  const rows = (await env.DB.prepare("SELECT org_id, data, updated_at FROM crm_snapshot").all()).results || [];
  const today = /* @__PURE__ */ new Date();
  const summary = [];
  for (const row of rows) {
    let data;
    try {
      data = await decodeSnapshot(row.data);
    } catch (e) {
      continue;
    }
    const contacts = Array.isArray(data.contacts) ? data.contacts : [];
    if (!Array.isArray(data.reminders)) data.reminders = [];
    let changed = false;
    for (const c of contacts) {
      if (c.status !== "Client") continue;
      if (!c.rate_locked_until) continue;
      const noticeDays = Number(c.notice_days);
      const effectiveNotice = Number.isFinite(noticeDays) && noticeDays > 0 ? noticeDays : 15;
      const renewal = nextMonthlyRenewal(c.rate_locked_until, today);
      if (!renewal) continue;
      const noticeStart = new Date(renewal.getTime() - effectiveNotice * 24 * 60 * 60 * 1e3);
      if (today.getTime() < noticeStart.getTime() || today.getTime() > renewal.getTime()) continue;
      const cycleKey = renewal.toISOString().slice(0, 10);
      const marker = "contract-notice:" + c.id + ":" + cycleKey;
      const already = data.reminders.some(function(rm) {
        return rm.system_marker === marker;
      });
      if (already) continue;
      data.reminders.push({
        id: genId("rem"),
        contact_id: c.id,
        kind: "Contract notice",
        title: "Contract notice window open: " + (c.name || c.id) + "'s monthly renewal is " + cycleKey + " (" + effectiveNotice + "-day notice).",
        at: today.toISOString(),
        done: false,
        assignee: null,
        system_marker: marker
      });
      changed = true;
    }
    if (changed) {
      const body = JSON.stringify(data);
      const saved=await writeSnapshot(env,row.org_id,body,"system:contract-deadline-engine",row);
      summary.push(saved?{org_id:row.org_id,remindersAdded:true}:{org_id:row.org_id,skipped:"workspace-changed"});
    }
  }
  return summary;
}
__name(runContractDeadlineCheck, "runContractDeadlineCheck");
__name2(runContractDeadlineCheck, "runContractDeadlineCheck");
var SVC_NAMES = { "01": "Transaction coordination", "02": "Listing management", "03": "CRM and database", "04": "Lead handling", "05": "Inbox and calendar", "06": "Marketing and social", "07": "Websites and landing pages" };
function svcName(code) {
  return SVC_NAMES[code] || code;
}
__name(svcName, "svcName");
__name2(svcName, "svcName");
function scopeStateOf(r) {
  const p = r.included ? (r.used || 0) / r.included : 0;
  return p > 1 ? "Over" : p >= 0.85 ? "Near limit" : "Within plan";
}
__name(scopeStateOf, "scopeStateOf");
__name2(scopeStateOf, "scopeStateOf");
function mondayOf(d) {
  const day = (d.getUTCDay() + 6) % 7;
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return mon;
}
__name(mondayOf, "mondayOf");
__name2(mondayOf, "mondayOf");
function weeklyCallPackText(c, data, monday) {
  const todos = Array.isArray(data.todos) ? data.todos : [];
  const tickets = Array.isArray(data.tickets) ? data.tickets : [];
  const scopeUsage = Array.isArray(data.scope_usage) ? data.scope_usage : [];
  const mine = todos.filter(function(t) {
    return t.contact_id === c.id;
  });
  const week = mine.filter(function(t) {
    return t.due_at && new Date(t.due_at).getTime() >= monday.getTime();
  });
  const L = [];
  L.push("SERENE OPS \xB7 WEEKLY CALL PACK \xB7 INTERNAL \xB7 DRAFT, NOT SENT");
  L.push(c.name + (c.brokerage ? " \u2014 " + c.brokerage : ""));
  L.push("Week of " + monday.toISOString().slice(0, 10));
  L.push("Generated automatically for review \u2014 nothing has been sent to the client.");
  L.push("");
  const doneW = week.filter(function(t) {
    return t.status === "Done";
  });
  const openW = week.filter(function(t) {
    return t.status === "Open";
  });
  L.push("COMPLETED THIS WEEK (" + doneW.length + ")");
  if (!doneW.length) L.push("  Nothing logged yet.");
  doneW.forEach(function(t) {
    L.push("  \xB7 " + t.title);
    L.push("      " + svcName(t.module) + " \xB7 " + (t.minutes || 0) + " min");
    if (t.completion_note) L.push("      Note: " + t.completion_note);
  });
  L.push("");
  L.push("STILL OPEN (" + openW.length + ")");
  if (!openW.length) L.push("  Nothing outstanding.");
  openW.forEach(function(t) {
    L.push("  \xB7 " + t.title + "  (" + svcName(t.module) + ")");
  });
  L.push("");
  const mins = doneW.reduce(function(a, t) {
    return a + (t.minutes || 0);
  }, 0);
  L.push("INTERNAL DELIVERY TIME: " + Math.round(mins / 6) / 10 + " hours across " + doneW.length + " completed items");
  const scopes = scopeUsage.filter(function(r) {
    return r.contact_id === c.id;
  });
  if (scopes.length) {
    L.push("");
    L.push("SCOPE / USAGE");
    scopes.forEach(function(r) {
      L.push("  \xB7 " + svcName(r.service) + ": " + r.used + " / " + r.included + " " + r.unit + " \xB7 " + scopeStateOf(r));
    });
  }
  const waits = tickets.filter(function(t) {
    return t.contact_id === c.id && t.status === "Waiting on client feedback";
  });
  if (waits.length) {
    L.push("");
    L.push("WAITING ON CLIENT");
    waits.forEach(function(t) {
      L.push("  \xB7 " + t.title);
    });
  }
  const tix = tickets.filter(function(t) {
    return t.contact_id === c.id && t.status !== "Query done";
  });
  if (tix.length) {
    L.push("");
    L.push("OPEN WITH US (" + tix.length + ")");
    tix.forEach(function(t) {
      L.push("  \xB7 [" + t.type + "] " + t.title + " \u2014 " + t.status);
    });
  }
  return L.join("\n");
}
__name(weeklyCallPackText, "weeklyCallPackText");
__name2(weeklyCallPackText, "weeklyCallPackText");
async function runWeeklyCallPackDrafts(env) {
  const today = /* @__PURE__ */ new Date();
  if (today.getUTCDay() !== 1) return { skipped: "not Monday (UTC)" };
  const monday = mondayOf(today);
  const weekKey = monday.toISOString().slice(0, 10);
  const rows = (await env.DB.prepare("SELECT org_id, data, updated_at FROM crm_snapshot").all()).results || [];
  const summary = [];
  for (const row of rows) {
    let data;
    try {
      data = await decodeSnapshot(row.data);
    } catch (e) {
      continue;
    }
    const contacts = Array.isArray(data.contacts) ? data.contacts : [];
    if (!Array.isArray(data.notes)) data.notes = [];
    if (!Array.isArray(data.reminders)) data.reminders = [];
    let changed = false;
    for (const c of contacts) {
      if (c.status !== "Client") continue;
      const marker = "weekly-call-pack:" + c.id + ":" + weekKey;
      if (data.notes.some(function(n) {
        return n.system_marker === marker;
      })) continue;
      const text = weeklyCallPackText(c, data, monday);
      data.notes.push({
        id: genId("note"),
        entity_type: "contact",
        entity_id: c.id,
        body: text,
        url: "",
        at: today.toISOString(),
        by: "Serene Ops \xB7 Weekly call pack engine (draft, unreviewed)",
        system_marker: marker
      });
      data.reminders.push({
        id: genId("rem"),
        contact_id: c.id,
        kind: "Weekly call pack",
        title: "Weekly call pack drafted for " + (c.name || c.id) + " \u2014 review before sending anything to the client.",
        at: today.toISOString(),
        done: false,
        assignee: null,
        system_marker: marker
      });
      changed = true;
    }
    if (changed) {
      const body = JSON.stringify(data);
      const saved=await writeSnapshot(env,row.org_id,body,"system:weekly-call-pack-engine",row);
      summary.push(saved?{org_id:row.org_id,draftsAdded:true}:{org_id:row.org_id,skipped:"workspace-changed"});
    }
  }
  return summary;
}
__name(runWeeklyCallPackDrafts, "runWeeklyCallPackDrafts");
__name2(runWeeklyCallPackDrafts, "runWeeklyCallPackDrafts");
function minusWorkingDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString();
}
__name(minusWorkingDay, "minusWorkingDay");
__name2(minusWorkingDay, "minusWorkingDay");
async function runAutomationsEngine(env) {
  const rows = (await env.DB.prepare("SELECT org_id, data, updated_at FROM crm_snapshot").all()).results || [];
  const now = /* @__PURE__ */ new Date();
  const summary = [];
  const after = /* @__PURE__ */ __name2(function(iso, days) {
    const d = new Date(iso);
    d.setDate(d.getDate() + (days || 0));
    return d;
  }, "after");
  for (const row of rows) {
    let data;
    try {
      data = await decodeSnapshot(row.data);
    } catch (e) {
      continue;
    }
    const rules = (Array.isArray(data.automations) ? data.automations : []).filter(function(r) {
      return r.enabled;
    });
    if (!rules.length) continue;
    const seen = {};
    (Array.isArray(data.autolog) ? data.autolog : []).forEach(function(k) {
      seen[k] = 1;
    });
    const deals = Array.isArray(data.deals) ? data.deals : [];
    const meetings = Array.isArray(data.meetings) ? data.meetings : [];
    const tickets = Array.isArray(data.tickets) ? data.tickets : [];
    const contacts = Array.isArray(data.contacts) ? data.contacts : [];
    const pending = [];
    rules.forEach(function(r) {
      if (r.on === "deal_stage") {
        deals.filter(function(d) {
          return d.stage === r.stage;
        }).forEach(function(d) {
          const since = d.stage_at || d.updated_at || d.created_at;
          if (after(since, r.delayDays) > now) return;
          const key = r.id + "|" + d.id + "|" + r.stage + "|" + since;
          if (seen[key]) return;
          pending.push({ r, key, cid: d.contact_id, ref: d });
        });
      } else if (r.on === "meeting_before") {
        meetings.forEach(function(m) {
          const at = new Date(m.at);
          if (at < now) return;
          if (new Date(at.getTime() - (r.hoursBefore || 2) * 36e5) > now) return;
          const key = r.id + "|" + m.id;
          if (seen[key]) return;
          pending.push({ r, key, cid: m.contact_id, at: m.at });
        });
      } else if (r.on === "ticket_status") {
        tickets.filter(function(t) {
          return t.status === r.status;
        }).forEach(function(t) {
          if (after(t.raised_at, r.delayDays) > now) return;
          const key = r.id + "|" + t.id + "|" + r.status;
          if (seen[key]) return;
          pending.push({ r, key, cid: t.contact_id, ref: t });
        });
      } else if (r.on === "contact_status") {
        contacts.filter(function(c) {
          return c.status === r.status && !c.deleted_at;
        }).forEach(function(c) {
          const key = r.id + "|" + c.id + "|" + r.status;
          if (seen[key]) return;
          pending.push({ r, key, cid: c.id, ref: c });
        });
      }
    });
    if (!pending.length) continue;
    if (!Array.isArray(data.todos)) data.todos = [];
    if (!Array.isArray(data.reminders)) data.reminders = [];
    if (!Array.isArray(data.autolog)) data.autolog = [];
    if (!Array.isArray(data.activity)) data.activity = [];
    pending.forEach(function(p) {
      const r = p.r;
      const c = contacts.find(function(x) {
        return x.id === p.cid;
      }) || {};
      const title = String(r.title || r.name || "").split("{client}").join(c.name || "them");
      if (r.do === "task") {
        let due;
        if (r.dueFromMeeting && p.ref && p.ref.meeting_at) due = new Date(minusWorkingDay(p.ref.meeting_at));
        else {
          due = /* @__PURE__ */ new Date();
          due.setDate(due.getDate() + (r.dueInDays || 0));
        }
        due.setHours(17, 0, 0, 0);
        data.todos.unshift({
          id: genId("w"),
          org_id: row.org_id,
          contact_id: p.cid,
          ticket_id: r.on === "ticket_status" && p.ref ? p.ref.id : null,
          title,
          module: r.module || "01",
          source: "Automation",
          status: "Open",
          due_at: due.toISOString(),
          minutes: 0,
          runs_outside_plan: !!r.outside,
          assignee: r.assignee || "",
          completion_note: "",
          auto: r.id
        });
      } else {
        let at;
        if (r.on === "meeting_before" && p.at) at = new Date(new Date(p.at).getTime() - (r.hoursBefore || 2) * 36e5);
        else {
          at = /* @__PURE__ */ new Date();
          at.setDate(at.getDate() + (r.dueInDays || 0));
          at.setHours(10, 0, 0, 0);
        }
        data.reminders.unshift({
          id: genId("r"),
          contact_id: p.cid,
          kind: r.kind || "Call",
          title,
          at: at.toISOString(),
          done: false,
          assignee: r.assignee || "",
          auto: r.id
        });
      }
      data.autolog.push(p.key);
      data.activity.unshift({
        id: genId("a"),
        at: now.toISOString(),
        who: "Automation",
        what: r.name + " \u2192 " + (r.do === "task" ? "task" : "reminder") + " created for " + (c.name || "a contact"),
        contact_id: p.cid
      });
    });
    if (data.autolog.length > 600) data.autolog = data.autolog.slice(-600);
    const body = JSON.stringify(data);
    const saved=await writeSnapshot(env,row.org_id,body,"system:automations-engine",row);
    summary.push(saved?{org_id:row.org_id,automationsRan:pending.length}:{org_id:row.org_id,skipped:"workspace-changed"});
  }
  return summary;
}
__name(runAutomationsEngine, "runAutomationsEngine");
__name2(runAutomationsEngine, "runAutomationsEngine");
async function logSystemAlert(env, jobName, errorMessage) {
  try {
    const rows = (await env.DB.prepare("SELECT org_id, data, updated_at FROM crm_snapshot").all()).results || [];
    const now = /* @__PURE__ */ new Date();
    for (const row of rows) {
      let data;
      try {
        data = await decodeSnapshot(row.data);
      } catch (e) {
        continue;
      }
      if (!Array.isArray(data.reminders)) data.reminders = [];
      data.reminders.unshift({
        id: genId("rem"),
        contact_id: null,
        kind: "System Alert",
        title: "\u26A0 " + jobName + " failed: " + String(errorMessage || "unknown error").slice(0, 300),
        at: now.toISOString(),
        done: false,
        assignee: null
      });
      const body = JSON.stringify(data);
      const saved=await writeSnapshot(env,row.org_id,body,"system:alerting",row);
      if(!saved)console.warn("System alert skipped because the workspace changed",row.org_id,jobName);
    }
  } catch (e) {
    console.error("logSystemAlert itself failed", e.message);
  }
}
__name(logSystemAlert, "logSystemAlert");
__name2(logSystemAlert, "logSystemAlert");
var zoomTokenCache = { accessToken: null, expiresAt: 0 };
async function getZoomAccessToken(env) {
  const now = Date.now();
  if (zoomTokenCache.accessToken && now < zoomTokenCache.expiresAt - 6e4) {
    return zoomTokenCache.accessToken;
  }
  if (!env.ZOOM_ACCOUNT_ID || !env.ZOOM_CLIENT_ID || !env.ZOOM_CLIENT_SECRET) {
    throw new Error("Zoom S2S OAuth credentials are not configured");
  }
  const basic = btoa(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`);
  const body = new URLSearchParams({ grant_type: "account_credentials", account_id: env.ZOOM_ACCOUNT_ID });
  const resp = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });
  if (!resp.ok) {
    let detail = "";
    try {
      detail = (await resp.text()).slice(0, 300);
    } catch (_) {
    }
    throw new Error(`Zoom OAuth token request failed: HTTP ${resp.status} ${detail}`);
  }
  const data = await resp.json();
  if (!data.access_token) throw new Error("Zoom OAuth response missing access_token");
  zoomTokenCache.accessToken = data.access_token;
  zoomTokenCache.expiresAt = now + (Number(data.expires_in) || 3600) * 1e3;
  return zoomTokenCache.accessToken;
}
__name(getZoomAccessToken, "getZoomAccessToken");
__name2(getZoomAccessToken, "getZoomAccessToken");
async function zoomApiGet(env, path) {
  const token = await getZoomAccessToken(env);
  const resp = await fetch(`https://api.zoom.us/v2${path}`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  let body = null;
  try {
    body = await resp.json();
  } catch (_) {
  }
  return { ok: resp.ok, status: resp.status, body };
}
__name(zoomApiGet, "zoomApiGet");
__name2(zoomApiGet, "zoomApiGet");
async function handleZoomCallHistoryCheck(request, env, user) {
  if (!user.isOwner) return errorResponse("Forbidden: Owner/Admin only", 403);
  const url = new URL(request.url);
  const needle = (url.searchParams.get("number") || "").replace(/\D/g, "");
  if (!needle) return errorResponse("number query param is required", 400);
  const today = /* @__PURE__ */ new Date();
  const from = new Date(today.getTime() - 24 * 3600 * 1e3).toISOString().slice(0, 10);
  const to = today.toISOString().slice(0, 10);
  const resp = await zoomApiGet(env, `/phone/call_history?type=all&from=${from}&to=${to}&page_size=100`);
  if (!resp.ok) return json({ data: { ok: false, status: resp.status, body: resp.body } }, resp.status);
  const entries = resp.body && resp.body.call_logs || [];
  const matches = entries.filter((en) => String(en.callee_number || "").replace(/\D/g, "").includes(needle) || String(en.caller_number || "").replace(/\D/g, "").includes(needle));
  return json({ data: { ok: true, matches, totalEntries: entries.length, sample: entries.slice(0, 3), rawTotalRecords: resp.body && resp.body.total_records } });
}
__name(handleZoomCallHistoryCheck, "handleZoomCallHistoryCheck");
__name2(handleZoomCallHistoryCheck, "handleZoomCallHistoryCheck");
async function enrichZoomOccurrenceUuid(env, zoomMeetingId, referenceTimeIso) {
  if (!zoomMeetingId) return null;
  try {
    const resp = await zoomApiGet(env, `/past_meetings/${zoomMeetingId}/instances`);
    if (!resp.ok || !resp.body) return null;
    const instances = resp.body.meetings || resp.body.instances || [];
    if (!instances.length) return null;
    const refMs = referenceTimeIso ? new Date(referenceTimeIso).getTime() : Date.now();
    if (!Number.isFinite(refMs)) return instances[0].uuid || null;
    let best = null, bestDiff = Infinity;
    for (const inst of instances) {
      const t = new Date(inst.start_time).getTime();
      if (!Number.isFinite(t)) continue;
      const diff = Math.abs(t - refMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = inst;
      }
    }
    return best && best.uuid || instances[0].uuid || null;
  } catch (e) {
    console.error("enrichZoomOccurrenceUuid failed", e && e.message);
    return null;
  }
}
__name(enrichZoomOccurrenceUuid, "enrichZoomOccurrenceUuid");
__name2(enrichZoomOccurrenceUuid, "enrichZoomOccurrenceUuid");
async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hmacSha256Hex, "hmacSha256Hex");
__name2(hmacSha256Hex, "hmacSha256Hex");
async function sha256Hex(message) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(message));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
__name2(sha256Hex, "sha256Hex");
function timingSafeEqualStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
__name(timingSafeEqualStr, "timingSafeEqualStr");
__name2(timingSafeEqualStr, "timingSafeEqualStr");
async function handleZoomWebhook(request, env) {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);
  if (!env.ZOOM_WEBHOOK_SECRET_TOKEN) {
    console.error("ZOOM_WEBHOOK_SECRET_TOKEN not configured");
    return errorResponse("Webhook not configured", 503);
  }
  const rawBody = await request.text();
  const timestampHeader = request.headers.get("x-zm-request-timestamp") || "";
  const signatureHeader = request.headers.get("x-zm-signature") || "";
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (_) {
    return errorResponse("Malformed payload", 400);
  }
  if (payload && payload.event === "endpoint.url_validation" && payload.payload && payload.payload.plainToken) {
    const encryptedToken = await hmacSha256Hex(env.ZOOM_WEBHOOK_SECRET_TOKEN, payload.payload.plainToken);
    return json({ plainToken: payload.payload.plainToken, encryptedToken }, 200);
  }
  if (!timestampHeader || !signatureHeader) {
    return errorResponse("Missing signature headers", 401);
  }
  const tsNum = Number(timestampHeader);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum * 1e3) > 5 * 60 * 1e3) {
    return errorResponse("Stale or invalid timestamp", 401);
  }
  const expectedSig = "v0=" + await hmacSha256Hex(env.ZOOM_WEBHOOK_SECRET_TOKEN, `v0:${timestampHeader}:${rawBody}`);
  if (!timingSafeEqualStr(expectedSig, signatureHeader)) {
    return errorResponse("Invalid signature", 401);
  }
  const payloadHash = await sha256Hex(rawBody);
  const eventType = typeof payload.event === "string" ? payload.event : "unknown";
  let objectJson = null;
  try {
    const obj0 = payload && payload.payload && payload.payload.object;
    if (obj0) objectJson = JSON.stringify(obj0).slice(0, 8e3);
  } catch (_) {
  }
  try {
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO zoom_webhook_events (id, event_type, payload_hash, object_json, processed) VALUES (?, ?, ?, ?, 0)"
    ).bind(genId("zwe"), eventType, payloadHash, objectJson).run();
    const alreadySeen = !(result.meta && result.meta.changes);
    if (alreadySeen) {
      return json({ received: true, duplicate: true }, 200);
    }
  } catch (e) {
    console.error("zoom webhook idempotency insert failed", e.message);
    return errorResponse("Internal error", 500);
  }
  try {
    await reconcileZoomEvent(env, eventType, payload && payload.payload && payload.payload.object);
  } catch (e) {
    console.error("zoom webhook reconciliation failed", eventType, e.message);
  }
  try {
    await env.DB.prepare("UPDATE zoom_webhook_events SET processed = 1 WHERE payload_hash = ?").bind(payloadHash).run();
  } catch (e) {
    console.error("zoom webhook mark-processed failed", e.message);
  }
  return json({ received: true }, 200);
}
__name(handleZoomWebhook, "handleZoomWebhook");
__name2(handleZoomWebhook, "handleZoomWebhook");
async function findMappedZoomUser(env, orgId, crmUserId) {
  return env.DB.prepare(
    "SELECT crm_user_id, zoom_user_id, zoom_extension, zoom_email FROM zoom_phone_user_map WHERE org_id = ? AND crm_user_id = ? AND active = 1"
  ).bind(orgId, crmUserId).first();
}
__name(findMappedZoomUser, "findMappedZoomUser");
__name2(findMappedZoomUser, "findMappedZoomUser");
async function findCrmUserByZoomUserId(env, orgId, zoomUserId) {
  if (!zoomUserId) return null;
  return env.DB.prepare(
    "SELECT crm_user_id, zoom_user_id, zoom_email, zoom_extension FROM zoom_phone_user_map WHERE org_id = ? AND zoom_user_id = ? AND active = 1 ORDER BY authorized_shared_identity ASC, created_at ASC LIMIT 1"
  ).bind(orgId, zoomUserId).first();
}
__name(findCrmUserByZoomUserId, "findCrmUserByZoomUserId");
__name2(findCrmUserByZoomUserId, "findCrmUserByZoomUserId");
async function loadSnapshotData(env, orgId) {
  const row = await env.DB.prepare("SELECT data FROM crm_snapshot WHERE org_id = ?").bind(orgId).first();
  if (!row || !row.data) return null;
  try {
    return await decodeSnapshot(row.data);
  } catch (e) {
    console.error("crm_snapshot corrupted while reading for match/validation", e.message);
    return null;
  }
}
__name(loadSnapshotData, "loadSnapshotData");
__name2(loadSnapshotData, "loadSnapshotData");
async function matchContactByPhone(env, orgId, phoneNumber) {
  if (!phoneNumber) return null;
  const digits = String(phoneNumber).replace(/[^\d]/g, "").slice(-10);
  if (!digits) return null;
  const data = await loadSnapshotData(env, orgId);
  const contacts = data && Array.isArray(data.contacts) ? data.contacts : [];
  const match = contacts.find(function(c) {
    if (!c || c.deleted_at || !c.phone) return false;
    return String(c.phone).replace(/\D/g, "").slice(-10) === digits;
  });
  return match ? match.id : null;
}
__name(matchContactByPhone, "matchContactByPhone");
__name2(matchContactByPhone, "matchContactByPhone");
async function reconcileZoomEvent(env, eventType, obj) {
  if (!obj) return;
  const orgId = "org1";
  if (eventType === "phone.caller_ended" || eventType === "phone.callee_ended") {
    await reconcilePhoneCallEnded(env, orgId, eventType, obj);
    return;
  }
  if (eventType === "phone.voicemail_received") {
    await reconcileVoicemailReceived(env, orgId, obj);
    return;
  }
  if (eventType === "meeting.started" || eventType === "meeting.ended") {
    await reconcileMeetingLifecycle(env, orgId, eventType, obj);
    return;
  }
  if (eventType === "meeting.summary_completed") {
    await reconcileMeetingSummary(env, orgId, obj);
    return;
  }
}
__name(reconcileZoomEvent, "reconcileZoomEvent");
__name2(reconcileZoomEvent, "reconcileZoomEvent");
async function reconcilePhoneCallEnded(env, orgId, eventType, obj) {
  const callId = obj.call_id;
  if (!callId) return;
  const caller = obj.caller || {};
  const callee = obj.callee || {};
  const direction = obj.direction || (callee.extension_type === "pstn" ? "outbound" : caller.extension_type === "pstn" ? "inbound" : "unknown");
  const durationSeconds = typeof obj.duration === "number" ? obj.duration : obj.connected_start_time && obj.call_end_time ? Math.max(0, Math.round((new Date(obj.call_end_time).getTime() - new Date(obj.connected_start_time).getTime()) / 1e3)) : null;
  let claim = await env.DB.prepare(
    "SELECT crm_user_id, crm_user_name, zoom_user_id FROM zoom_call_initiations WHERE zoom_call_id = ?"
  ).bind(callId).first();
  if (!claim) {
    const destForClaim = direction === "outbound" ? callee.phone_number || null : null;
    if (destForClaim) {
      const pending = await env.DB.prepare(
        "SELECT zoom_call_id as pending_id, crm_user_id, crm_user_name, zoom_user_id FROM zoom_call_initiations WHERE org_id = ? AND dest_number = ? AND zoom_call_id LIKE 'pending:%' AND created_at >= datetime('now','-5 minutes') ORDER BY created_at DESC LIMIT 1"
      ).bind(orgId, destForClaim).first();
      if (pending) {
        claim = pending;
        await env.DB.prepare("UPDATE zoom_call_initiations SET zoom_call_id = ? WHERE zoom_call_id = ?").bind(callId, pending.pending_id).run();
      }
    }
  }
  const byCaller = caller.user_id ? await findCrmUserByZoomUserId(env, orgId, caller.user_id) : null;
  const byCallee = callee.user_id ? await findCrmUserByZoomUserId(env, orgId, callee.user_id) : null;
  const owner = byCaller || byCallee;
  const initiatedBy = claim ? claim.crm_user_id : owner ? owner.crm_user_id : null;
  const attribution = initiatedBy ? "assigned" : "unassigned";
  const licensedZoomUserId = claim && claim.zoom_user_id || owner && owner.zoom_user_id || caller.user_id || callee.user_id || null;
  let zoomPhoneIdentity = null;
  if (licensedZoomUserId) {
    const identityRow = await env.DB.prepare(
      "SELECT zoom_email, zoom_extension FROM zoom_phone_user_map WHERE org_id = ? AND zoom_user_id = ? ORDER BY authorized_shared_identity ASC, created_at ASC LIMIT 1"
    ).bind(orgId, licensedZoomUserId).first();
    zoomPhoneIdentity = identityRow ? identityRow.zoom_email || identityRow.zoom_extension || licensedZoomUserId : licensedZoomUserId;
  }
  const externalNumber = direction === "outbound" ? callee.phone_number || null : caller.phone_number || null;
  const contactId = await matchContactByPhone(env, orgId, externalNumber);
  const existing = await env.DB.prepare("SELECT id FROM zoom_calls WHERE zoom_call_id = ?").bind(callId).first();
  const now = isoNow();
  if (existing) {
    await env.DB.prepare(
      `UPDATE zoom_calls SET direction = COALESCE(?, direction), from_number = COALESCE(?, from_number),
        to_number = COALESCE(?, to_number), status = 'ended', duration_seconds = COALESCE(?, duration_seconds),
        initiated_by = COALESCE(initiated_by, ?), attribution = CASE WHEN initiated_by IS NULL AND ? IS NOT NULL THEN 'assigned' ELSE attribution END,
        zoom_phone_identity = COALESCE(zoom_phone_identity, ?),
        contact_id = COALESCE(contact_id, ?), match_status = CASE WHEN contact_id IS NULL AND ? IS NOT NULL THEN 'matched' ELSE match_status END,
        updated_at = ? WHERE id = ?`
    ).bind(direction, caller.phone_number || null, callee.phone_number || null, durationSeconds, initiatedBy, initiatedBy, zoomPhoneIdentity, contactId, contactId, now, existing.id).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO zoom_calls (id, org_id, call_id, zoom_call_id, zoom_event_id, direction, from_number, to_number, status, duration_seconds, initiated_by, attribution, zoom_phone_identity, contact_id, match_status, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'ended', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(genId("zc"), orgId, callId, eventType, direction, caller.phone_number || null, callee.phone_number || null, durationSeconds, initiatedBy, attribution, zoomPhoneIdentity, contactId, contactId ? "matched" : "unmatched", now, now).run();
}
__name(reconcilePhoneCallEnded, "reconcilePhoneCallEnded");
__name2(reconcilePhoneCallEnded, "reconcilePhoneCallEnded");
async function reconcileVoicemailReceived(env, orgId, obj) {
  const vmId = obj.id;
  if (!vmId) return;
  const existing = await env.DB.prepare("SELECT id FROM zoom_voicemails WHERE id = ?").bind("zvm_" + vmId).first();
  if (existing) return;
  const contactId = await matchContactByPhone(env, orgId, obj.caller_number);
  const zoomCall = obj.call_id ? await env.DB.prepare("SELECT id FROM zoom_calls WHERE zoom_call_id = ?").bind(obj.call_id).first() : null;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO zoom_voicemails (id, org_id, zoom_call_row_id, contact_id, from_number, duration_seconds, recording_url, transcript, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'unread', ?)`
  ).bind("zvm_" + vmId, orgId, zoomCall ? zoomCall.id : null, contactId, obj.caller_number || null, typeof obj.duration === "number" ? obj.duration : null, obj.download_url || null, isoNow()).run();
}
__name(reconcileVoicemailReceived, "reconcileVoicemailReceived");
__name2(reconcileVoicemailReceived, "reconcileVoicemailReceived");
async function mutateOrgSnapshot(env, orgId, mutatorFn, attempt) {
  attempt = attempt || 0;
  const row = await env.DB.prepare("SELECT data, updated_at FROM crm_snapshot WHERE org_id = ?").bind(orgId).first();
  let data = {};
  if (row && row.data) {
    try {
      data = await decodeSnapshot(row.data);
    } catch (e) {
      console.error("crm_snapshot corrupted, skipping server-side meeting sync", e.message);
      return;
    }
  }
  if (!Array.isArray(data.meetings)) data.meetings = [];
  const changed = mutatorFn(data);
  if (!changed) return;
  const landed = !!(await writeSnapshot(env,orgId,JSON.stringify(data),"system:zoom",row));
  if (landed) return;
  if (attempt >= 6) {
    console.error("mutateOrgSnapshot: gave up after concurrent-write retries", orgId);
    return;
  }
  await new Promise(function(resolve) {
    setTimeout(resolve, 40 + attempt * 80);
  });
  return mutateOrgSnapshot(env, orgId, mutatorFn, attempt + 1);
}
__name(mutateOrgSnapshot, "mutateOrgSnapshot");
__name2(mutateOrgSnapshot, "mutateOrgSnapshot");
async function resolveHostDisplayName(env, orgId, hostMap, obj) {
  if (hostMap && hostMap.crm_user_id) {
    try {
      const u = await env.DB.prepare("SELECT name FROM users WHERE id = ? AND org_id = ?").bind(hostMap.crm_user_id, orgId).first();
      if (u && u.name) return u.name;
    } catch (e) {
    }
  }
  return obj.host_email || obj.host_id || null;
}
__name(resolveHostDisplayName, "resolveHostDisplayName");
__name2(resolveHostDisplayName, "resolveHostDisplayName");
async function backfillMeetingSyncFromLedger(env, orgId) {
  const rows = (await env.DB.prepare(
    "SELECT zoom_meeting_id, host_user_id, topic, start_time, duration_minutes, summary, summary_status FROM zoom_meetings WHERE org_id = ?"
  ).bind(orgId).all()).results || [];
  const hostNames = {};
  for (const row of rows) {
    if (row.host_user_id && !(row.host_user_id in hostNames)) {
      const u = await env.DB.prepare("SELECT name FROM users WHERE id = ? AND org_id = ?").bind(row.host_user_id, orgId).first();
      hostNames[row.host_user_id] = u && u.name || null;
    }
  }
  let touched = 0;
  const now = isoNow();
  for (const row of rows) {
    const zoomMeetingId = row.zoom_meeting_id;
    if (!zoomMeetingId) continue;
    const hostName = hostNames[row.host_user_id] || null;
    const existing = await env.DB.prepare(
      "SELECT id FROM zoom_crm_meetings WHERE org_id = ? AND zoom_meeting_id = ? AND zoom_uuid IS NULL"
    ).bind(orgId, zoomMeetingId).first();
    if (existing) {
      await env.DB.prepare(
        `UPDATE zoom_crm_meetings SET
           zoom_topic = COALESCE(?, zoom_topic), zoom_host = COALESCE(?, zoom_host),
           at = COALESCE(?, at), meeting_duration_seconds = COALESCE(?, meeting_duration_seconds),
           summary_status = CASE WHEN ? = 'available' THEN 'available' ELSE summary_status END,
           summary_source = CASE WHEN ? = 'available' AND summary_source IS NULL THEN 'zoom_ai_companion' ELSE summary_source END,
           summary_overview = CASE WHEN summary_overview IS NULL THEN ? ELSE summary_overview END,
           updated_at = ?
         WHERE id = ?`
      ).bind(row.topic || null, hostName, row.start_time || null, typeof row.duration_minutes === "number" ? row.duration_minutes * 60 : null, row.summary_status, row.summary_status, row.summary, now, existing.id).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO zoom_crm_meetings (id, org_id, zoom_meeting_id, zoom_uuid, zoom_topic, zoom_host, zoom_status, assignee, at, meeting_duration_seconds, summary_status, summary_source, summary_overview, summary_created_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, 'ended', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        genId("meet"),
        orgId,
        zoomMeetingId,
        row.topic || null,
        hostName,
        hostName || "Unassigned",
        row.start_time || now,
        typeof row.duration_minutes === "number" ? row.duration_minutes * 60 : null,
        row.summary_status === "available" ? "available" : "none",
        row.summary_status === "available" ? "zoom_ai_companion" : null,
        row.summary_status === "available" ? row.summary : null,
        row.summary_status === "available" ? now : null,
        now,
        now
      ).run();
    }
    touched++;
  }
  return { rowsConsidered: rows.length, touched };
}
__name(backfillMeetingSyncFromLedger, "backfillMeetingSyncFromLedger");
__name2(backfillMeetingSyncFromLedger, "backfillMeetingSyncFromLedger");
async function reconcileMeetingLifecycle(env, orgId, eventType, obj) {
  let zoomUuid = obj.uuid || obj.meeting_uuid || null;
  const zoomMeetingId = String(obj.id || zoomUuid || "");
  if (!zoomMeetingId) return;
  if (!zoomUuid) {
    zoomUuid = await enrichZoomOccurrenceUuid(env, zoomMeetingId, obj.start_time || null);
  }
  const hostZoomUserId = obj.host_id || null;
  const hostMap = hostZoomUserId ? await findCrmUserByZoomUserId(env, orgId, hostZoomUserId) : null;
  const hostDisplayName = await resolveHostDisplayName(env, orgId, hostMap, obj);
  const now = isoNow();
  const existingLedger = await env.DB.prepare("SELECT id FROM zoom_meetings WHERE zoom_meeting_id = ?").bind(zoomMeetingId).first();
  if (existingLedger) {
    await env.DB.prepare(
      "UPDATE zoom_meetings SET topic = COALESCE(?, topic), start_time = COALESCE(?, start_time), duration_minutes = COALESCE(?, duration_minutes), host_user_id = COALESCE(host_user_id, ?), updated_at = ? WHERE id = ?"
    ).bind(obj.topic || null, obj.start_time || null, typeof obj.duration === "number" ? obj.duration : null, hostMap ? hostMap.crm_user_id : null, now, existingLedger.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO zoom_meetings (id, org_id, meeting_id, zoom_meeting_id, host_user_id, topic, start_time, duration_minutes, join_url, summary, summary_status, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, 'pending', ?, ?)`
    ).bind(genId("zm"), orgId, zoomMeetingId, hostMap ? hostMap.crm_user_id : null, obj.topic || null, obj.start_time || null, typeof obj.duration === "number" ? obj.duration : null, obj.join_url || null, now, now).run();
  }
  const matchCol = zoomUuid ? "zoom_uuid = ?" : "zoom_meeting_id = ? AND zoom_uuid IS NULL";
  const matchVal = zoomUuid || zoomMeetingId;
  const existingCrm = await env.DB.prepare(
    `SELECT id, zoom_status FROM zoom_crm_meetings WHERE org_id = ? AND ${matchCol}`
  ).bind(orgId, matchVal).first();
  const newStatus = eventType === "meeting.ended" ? "ended" : "started";
  if (existingCrm) {
    const finalStatus = eventType === "meeting.ended" ? "ended" : existingCrm.zoom_status === "ended" ? "ended" : "started";
    await env.DB.prepare(
      `UPDATE zoom_crm_meetings SET
         zoom_topic = COALESCE(?, zoom_topic),
         zoom_host = COALESCE(?, zoom_host),
         assignee = CASE WHEN assignee IS NULL OR assignee = 'Unassigned' THEN COALESCE(?, assignee) ELSE assignee END,
         at = COALESCE(?, at),
         timezone = COALESCE(?, timezone),
         zoom_status = ?,
         meeting_ended_at = COALESCE(?, meeting_ended_at),
         meeting_duration_seconds = COALESCE(?, meeting_duration_seconds),
         updated_at = ?
       WHERE id = ?`
    ).bind(
      obj.topic || null,
      hostDisplayName || null,
      hostDisplayName || null,
      obj.start_time || null,
      obj.timezone || null,
      finalStatus,
      eventType === "meeting.ended" ? obj.end_time || now : null,
      eventType === "meeting.ended" && typeof obj.duration === "number" ? obj.duration * 60 : null,
      now,
      existingCrm.id
    ).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO zoom_crm_meetings (id, org_id, zoom_meeting_id, zoom_uuid, zoom_topic, zoom_host, zoom_status, assignee, at, timezone, meeting_duration_seconds, meeting_ended_at, summary_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?)`
    ).bind(
      genId("meet"),
      orgId,
      zoomMeetingId,
      zoomUuid,
      obj.topic || null,
      hostDisplayName || null,
      newStatus,
      hostDisplayName || "Unassigned",
      obj.start_time || now,
      obj.timezone || null,
      eventType === "meeting.ended" && typeof obj.duration === "number" ? obj.duration * 60 : null,
      eventType === "meeting.ended" ? obj.end_time || now : null,
      now,
      now
    ).run();
  }
}
__name(reconcileMeetingLifecycle, "reconcileMeetingLifecycle");
__name2(reconcileMeetingLifecycle, "reconcileMeetingLifecycle");
async function reconcileMeetingSummary(env, orgId, obj) {
  let zoomUuid = obj.meeting_uuid || obj.uuid || null;
  const zoomMeetingId = String(obj.meeting_id || obj.id || zoomUuid || "");
  if (!zoomMeetingId) return;
  if (!zoomUuid) {
    zoomUuid = await enrichZoomOccurrenceUuid(env, zoomMeetingId, obj.meeting_start_time || obj.start_time || null);
  }
  const overview = obj.summary_overview || obj.summary_title || null;
  const normalizeItems = /* @__PURE__ */ __name(function(arr) {
    return (Array.isArray(arr) ? arr : []).map(function(x) {
      if (typeof x === "string") return x;
      if (x && typeof x === "object") return x.summary || x.label || x.content || JSON.stringify(x);
      return String(x);
    }).filter(Boolean);
  }, "normalizeItems");
  const details = normalizeItems(obj.summary_details);
  const steps = normalizeItems(obj.next_steps);
  const fullText = obj.summary_content || (details.length ? details.join("\n\n") : null);
  if (!overview && !details.length && !fullText) return;
  const now = isoNow();
  await env.DB.prepare(
    "UPDATE zoom_meetings SET summary = ?, summary_status = 'available', updated_at = ? WHERE zoom_meeting_id = ?"
  ).bind(overview || fullText || JSON.stringify(details), now, zoomMeetingId).run();
  const matchCol = zoomUuid ? "zoom_uuid = ?" : "zoom_meeting_id = ? AND zoom_uuid IS NULL";
  const matchVal = zoomUuid || zoomMeetingId;
  const existingCrm = await env.DB.prepare(
    `SELECT id FROM zoom_crm_meetings WHERE org_id = ? AND ${matchCol}`
  ).bind(orgId, matchVal).first();
  const detailsJson = details.length ? JSON.stringify(details) : null;
  const stepsJson = steps.length ? JSON.stringify(steps) : null;
  if (existingCrm) {
    await env.DB.prepare(
      `UPDATE zoom_crm_meetings SET
         summary_status = CASE WHEN summary_source = 'manual' THEN summary_status ELSE 'available' END,
         summary_source = CASE WHEN summary_source = 'manual' THEN summary_source ELSE 'zoom_ai_companion' END,
         summary_overview = CASE WHEN summary_source = 'manual' THEN summary_overview ELSE COALESCE(?, summary_overview) END,
         summary_text = CASE WHEN summary_source = 'manual' THEN summary_text ELSE COALESCE(?, summary_text) END,
         summary_details = CASE WHEN summary_source = 'manual' THEN summary_details ELSE COALESCE(?, summary_details) END,
         summary_next_steps = CASE WHEN summary_source = 'manual' THEN summary_next_steps ELSE COALESCE(?, summary_next_steps) END,
         summary_created_at = CASE WHEN summary_source = 'manual' THEN summary_created_at ELSE ? END,
         updated_at = ?
       WHERE id = ?`
    ).bind(overview || null, fullText || null, detailsJson, stepsJson, now, now, existingCrm.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO zoom_crm_meetings (id, org_id, zoom_meeting_id, zoom_uuid, zoom_status, assignee, summary_status, summary_source, summary_overview, summary_text, summary_details, summary_next_steps, summary_created_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ended', 'Unassigned', 'available', 'zoom_ai_companion', ?, ?, ?, ?, ?, ?, ?)`
    ).bind(genId("meet"), orgId, zoomMeetingId, zoomUuid, overview || null, fullText || null, detailsJson, stepsJson, now, now, now).run();
  }
}
__name(reconcileMeetingSummary, "reconcileMeetingSummary");
__name2(reconcileMeetingSummary, "reconcileMeetingSummary");
async function handleZoomMeetingPatch(request, env, user, zoomMeetingId) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }
  const row = await env.DB.prepare("SELECT id FROM zoom_crm_meetings WHERE org_id = ? AND zoom_meeting_id = ?").bind(user.orgId, zoomMeetingId).first();
  if (!row) return errorResponse("Zoom meeting not found", 404);
  const sets = [];
  const vals = [];
  if (Object.prototype.hasOwnProperty.call(body, "contactId")) {
    if (body.contactId) {
      const data = await loadSnapshotData(env, user.orgId);
      const contacts = data && Array.isArray(data.contacts) ? data.contacts : [];
      const contact = contacts.find(function(c) {
        return c && c.id === body.contactId && !c.deleted_at;
      });
      if (!contact) return errorResponse("Contact not found", 404);
      sets.push("matched_contact_id = ?");
      vals.push(body.contactId);
      sets.push("match_state = 'matched'");
    } else {
      sets.push("matched_contact_id = NULL", "match_state = 'unmatched'");
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "dealId")) {
    if (body.dealId) {
      const data = await loadSnapshotData(env, user.orgId);
      const deals = data && Array.isArray(data.deals) ? data.deals : [];
      const deal = deals.find(function(d) {
        return d && d.id === body.dealId;
      });
      if (!deal) return errorResponse("Deal not found", 404);
      sets.push("matched_deal_id = ?");
      vals.push(body.dealId);
    } else {
      sets.push("matched_deal_id = NULL");
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "internalNotes")) {
    sets.push("internal_notes = ?");
    vals.push(String(body.internalNotes || ""));
  }
  if (Object.prototype.hasOwnProperty.call(body, "archived")) {
    sets.push("archived_at = ?");
    vals.push(body.archived ? isoNow() : null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "manualSummary")) {
    const text = String(body.manualSummary || "").trim();
    if (!text) return errorResponse("manualSummary cannot be empty", 400);
    sets.push("summary_overview = ?", "summary_status = 'available'", "summary_source = 'manual'", "summary_created_at = ?");
    vals.push(text, isoNow());
  }
  if (!sets.length) return errorResponse("No recognized fields to update (contactId, dealId, internalNotes, archived, manualSummary)", 400);
  sets.push("updated_at = ?");
  vals.push(isoNow());
  vals.push(row.id);
  await env.DB.prepare(`UPDATE zoom_crm_meetings SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return json({ data: { ok: true } });
}
__name(handleZoomMeetingPatch, "handleZoomMeetingPatch");
__name2(handleZoomMeetingPatch, "handleZoomMeetingPatch");
async function handleZoomPhoneUsers(env) {
  try {
    const r = await zoomApiGet(env, "/phone/users?page_size=100");
    if (!r.ok) return { ok: false, status: r.status, error: r.body && r.body.message || "Zoom API error" };
    const users = Array.isArray(r.body && r.body.users) ? r.body.users : [];
    return {
      ok: true,
      users: users.map(function(u) {
        return { zoomUserId: u.user_id || u.id, email: u.email, name: [u.first_name, u.last_name].filter(Boolean).join(" "), extensionNumber: u.extension_number || u.ext || null, status: u.status || null };
      })
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
__name(handleZoomPhoneUsers, "handleZoomPhoneUsers");
__name2(handleZoomPhoneUsers, "handleZoomPhoneUsers");
async function handleZoomPhoneMapping(request, env, user) {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const targetUserId = user.isOwner && url.searchParams.get("userId") || user.id;
    const row = await findMappedZoomUser(env, user.orgId, targetUserId);
    return json({ data: row || null });
  }
  if (request.method === "POST") {
    if (!user.isOwner) return errorResponse("Forbidden: only Owner/Admin can map Zoom Phone identities", 403);
    let body;
    try {
      body = await request.json();
    } catch (_) {
      return errorResponse("Invalid JSON body", 400);
    }
    const crmUserId = body && body.crmUserId;
    const zoomUserId = body && body.zoomUserId;
    if (!crmUserId || !zoomUserId) return errorResponse("crmUserId and zoomUserId are required", 400);
    const target = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND org_id = ? AND deleted_at IS NULL").bind(crmUserId, user.orgId).first();
    if (!target) return errorResponse("CRM user not found", 404);
    const licenseOwnerRow = await env.DB.prepare(
      "SELECT crm_user_id FROM zoom_phone_user_map WHERE org_id = ? AND zoom_user_id = ? AND active = 1 AND authorized_shared_identity = 0 AND crm_user_id != ?"
    ).bind(user.orgId, zoomUserId, crmUserId).first();
    if (licenseOwnerRow && !(body && body.authorizedSharedIdentity === true)) {
      return errorResponse("This Zoom Phone identity is already licensed to a different CRM user. Resubmit with authorizedSharedIdentity: true to explicitly grant " + crmUserId + " authorized shared use of that same identity (their own license ownership is not created or changed).", 409);
    }
    const isShared = !!licenseOwnerRow;
    const now = isoNow();
    await env.DB.prepare(
      `INSERT INTO zoom_phone_user_map (id, org_id, crm_user_id, zoom_user_id, zoom_extension, zoom_email, active, authorized_shared_identity, licensed_owner_crm_user_id, authorized_by, authorized_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id, crm_user_id) DO UPDATE SET zoom_user_id = excluded.zoom_user_id, zoom_extension = excluded.zoom_extension, zoom_email = excluded.zoom_email, active = 1,
         authorized_shared_identity = excluded.authorized_shared_identity, licensed_owner_crm_user_id = excluded.licensed_owner_crm_user_id,
         authorized_by = excluded.authorized_by, authorized_at = excluded.authorized_at, updated_at = excluded.updated_at`
    ).bind(
      genId("zpm"),
      user.orgId,
      crmUserId,
      zoomUserId,
      body.zoomExtension || null,
      body.zoomEmail || null,
      isShared ? 1 : 0,
      isShared ? licenseOwnerRow.crm_user_id : null,
      isShared ? user.name || user.email || user.id : null,
      isShared ? now : null,
      now,
      now
    ).run();
    await logActivity(env, user, isShared ? "authorize-shared-zoom-phone-identity" : "map-zoom-phone-identity", "zoom_phone_user_map", crmUserId, null);
    return json({ data: { ok: true, authorizedSharedIdentity: isShared } });
  }
  return errorResponse("Method not allowed", 405);
}
__name(handleZoomPhoneMapping, "handleZoomPhoneMapping");
__name2(handleZoomPhoneMapping, "handleZoomPhoneMapping");
async function handleZoomCallsList(request, env, user) {
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "100", 10) || 100));
  const calls = await env.DB.prepare(
    `SELECT id, call_id, zoom_call_id, direction, from_number, to_number, status,
            duration_seconds, initiated_by, attribution, zoom_phone_identity, contact_id, match_status,
            created_at, updated_at
     FROM zoom_calls WHERE org_id = ? ORDER BY updated_at DESC LIMIT ?`
  ).bind(user.orgId, limit).all();
  const rows = calls && calls.results || [];
  const initiatorIds = Array.from(new Set(rows.map((rrow) => rrow.initiated_by).filter(Boolean)));
  let namesById = {};
  if (initiatorIds.length) {
    const placeholders = initiatorIds.map(() => "?").join(",");
    const users = await env.DB.prepare(
      `SELECT id, name FROM users WHERE org_id = ? AND id IN (${placeholders})`
    ).bind(user.orgId, ...initiatorIds).all();
    (users && users.results || []).forEach((u2) => {
      namesById[u2.id] = u2.name;
    });
  }
  const callsOut = rows.map((rrow) => Object.assign({}, rrow, {
    initiated_by_name: rrow.initiated_by ? namesById[rrow.initiated_by] || null : null
  }));
  const voicemails = await env.DB.prepare(
    `SELECT id, zoom_call_row_id, contact_id, from_number, duration_seconds,
            transcript, status, created_at
     FROM zoom_voicemails WHERE org_id = ? ORDER BY created_at DESC LIMIT ?`
  ).bind(user.orgId, limit).all();
  return json({ data: { calls: callsOut, voicemails: voicemails && voicemails.results || [] } });
}
__name(handleZoomCallsList, "handleZoomCallsList");
__name2(handleZoomCallsList, "handleZoomCallsList");
async function handleZoomCallClaim(request, env, user) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return errorResponse("Invalid JSON body", 400);
  }
  const zoomCallId = body && body.zoomCallId;
  const destNumber = body && body.destNumber;
  let queueContact=null;
  if(body?.queueContactId){
    if(zoomCallId)return errorResponse('A queued call must be checked using its assigned contact.',400);
    const check=await handleCallQueue(new Request('https://crm.internal/api/call-queue/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contactId:body.queueContactId,inactivityDays:body.inactivityDays})}),env,user);
    const checked=await check.json();
    if(!check.ok)return json(checked,check.status);
    const digits=value=>String(value||'').replace(/\D/g,'');
    if(!checked.eligible||!checked.contact?.phone||!destNumber||digits(destNumber)!==digits(checked.contact.phone))return errorResponse('The client number changed. Refresh the calling list.',409);
    queueContact=checked.contact;
  }else if(!user.isOwner)return errorResponse('Use your assigned calling list to start a call.',403);
  if (!zoomCallId && !destNumber) return errorResponse("zoomCallId or destNumber is required", 400);
  const mapping = await findMappedZoomUser(env, user.orgId, user.id);
  if (!mapping) return errorResponse("Forbidden: no active Zoom Phone identity mapped or authorized for this CRM user", 403);
  const now = isoNow();
  const claimId = zoomCallId || "pending:" + destNumber + ":" + Date.now();
  await env.DB.prepare(
    `INSERT INTO zoom_call_initiations (zoom_call_id, org_id, crm_user_id, crm_user_name, zoom_user_id, authorized_shared_identity, dest_number, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(zoom_call_id) DO NOTHING`
  ).bind(claimId, user.orgId, user.id, user.name || user.email || user.id, mapping.zoom_user_id, mapping.authorized_shared_identity ? 1 : 0, destNumber || null, now).run();
  return json({ data: { ok: true, claimId,...(queueContact?{closesAt:queueContact.closesAt}: {}) } });
}
__name(handleZoomCallClaim, "handleZoomCallClaim");
__name2(handleZoomCallClaim, "handleZoomCallClaim");
async function handleZoomDiagnostics(env) {
  const out = { oauth: null, accountUsers: null, phoneUsers: null, phoneCallLogs: null };
  try {
    await getZoomAccessToken(env);
    out.oauth = { ok: true };
  } catch (e) {
    out.oauth = { ok: false, error: e.message };
    return json(out, 200);
  }
  try {
    const r0 = await zoomApiGet(env, "/users?page_size=1");
    out.accountUsers = { status: r0.status, ok: r0.ok, count: r0.body && typeof r0.body.total_records === "number" ? r0.body.total_records : null };
  } catch (e) {
    out.accountUsers = { ok: false, error: e.message };
  }
  try {
    const r1 = await zoomApiGet(env, "/phone/users?page_size=1");
    out.phoneUsers = { status: r1.status, ok: r1.ok, count: r1.body && typeof r1.body.total_records === "number" ? r1.body.total_records : null };
  } catch (e) {
    out.phoneUsers = { ok: false, error: e.message };
  }
  out.phoneNumbersCheck = null;
  try {
    const rn = await zoomApiGet(env, "/phone/numbers?page_size=100");
    const nums = rn.body && Array.isArray(rn.body.phone_numbers) ? rn.body.phone_numbers : [];
    out.phoneNumbersCheck = {
      status: rn.status,
      ok: rn.ok,
      total: nums.length,
      hasTarget: nums.some((n) => String(n.number || "").replace(/\D/g, "").endsWith("3052032712")),
      sampleNumbers: nums.slice(0, 20).map((n) => ({ number: n.number, assignee: n.assignee && n.assignee.name, type: n.assignee && n.assignee.type })),
      rawErrorBody: rn.ok ? null : rn.body
    };
  } catch (e) {
    out.phoneNumbersCheck = { ok: false, error: e.message };
  }
  try {
    const r2 = await zoomApiGet(env, "/phone/call_logs?page_size=1");
    out.phoneCallLogs = { status: r2.status, ok: r2.ok, count: r2.body && typeof r2.body.total_records === "number" ? r2.body.total_records : null };
  } catch (e) {
    out.phoneCallLogs = { ok: false, error: e.message };
  }
  out.meetings = null;
  out.meetingDetail = null;
  out.meetingSummary = null;
  try {
    const pu = await zoomApiGet(env, "/phone/users?page_size=1");
    const userId = pu.body && Array.isArray(pu.body.users) && pu.body.users[0] ? pu.body.users[0].user_id || pu.body.users[0].id : null;
    if (!userId) {
      out.meetings = { ok: false, error: "No Zoom user id available from phone/users to query meetings for" };
    } else {
      const rm = await zoomApiGet(env, `/users/${userId}/meetings?type=previous_meetings&page_size=1`);
      out.meetings = { status: rm.status, ok: rm.ok, count: rm.body && typeof rm.body.total_records === "number" ? rm.body.total_records : null };
      const firstMeeting = rm.body && Array.isArray(rm.body.meetings) ? rm.body.meetings[0] : null;
      if (firstMeeting && firstMeeting.id) {
        const rd = await zoomApiGet(env, `/meetings/${firstMeeting.id}`);
        out.meetingDetail = { status: rd.status, ok: rd.ok, hasTopic: !!(rd.body && rd.body.topic), hasStartTime: !!(rd.body && rd.body.start_time) };
        const rs = await zoomApiGet(env, `/meetings/${firstMeeting.id}/meeting_summary`);
        out.meetingSummary = { status: rs.status, ok: rs.ok, hasSummary: !!(rs.body && (rs.body.summary_overview || rs.body.summary_details)) };
      } else {
        out.meetingDetail = { ok: false, error: "No prior meetings found to query" };
        out.meetingSummary = { ok: false, error: "No prior meetings found to query" };
      }
    }
  } catch (e) {
    out.meetings = out.meetings || { ok: false, error: e.message };
  }
  return json(out, 200);
}
__name(handleZoomDiagnostics, "handleZoomDiagnostics");
__name2(handleZoomDiagnostics, "handleZoomDiagnostics");
var ZOHO_SCOPES = "ZohoMail.messages.ALL,ZohoMail.accounts.READ,ZohoMail.folders.READ";
async function getZohoOAuthRow(env, orgId) {
  return env.DB.prepare("SELECT * FROM zoho_oauth_tokens WHERE org_id = ?").bind(orgId).first();
}
__name(getZohoOAuthRow, "getZohoOAuthRow");
__name2(getZohoOAuthRow, "getZohoOAuthRow");
function zohoMailApiDomain(accountsServer) {
  try {
    const host = new URL(accountsServer).host;
    const mailHost = host.replace(/^accounts\./, "mail.");
    return "https://" + mailHost;
  } catch (e) {
    return "https://mail.zoho.com";
  }
}
__name(zohoMailApiDomain, "zohoMailApiDomain");
__name2(zohoMailApiDomain, "zohoMailApiDomain");
async function getZohoAccessToken(env, orgId) {
  const row = await getZohoOAuthRow(env, orgId);
  if (!row) throw new Error("Zoho is not connected for this organization");
  const now = Date.now();
  const expMs = new Date(row.access_token_expires_at).getTime();
  if (Number.isFinite(expMs) && now < expMs - 6e4) {
    return { accessToken: row.access_token, apiDomain: row.api_domain, mailApiDomain: zohoMailApiDomain(row.accounts_server), accountId: row.zoho_account_id, accountsServer: row.accounts_server };
  }
  if (!env.ZOHO_CLIENT_ID || !env.ZOHO_CLIENT_SECRET) {
    throw new Error("Zoho OAuth credentials are not configured");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    refresh_token: row.refresh_token
  });
  const resp = await fetch(`${row.accounts_server}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const json2 = await resp.json().catch(() => null);
  if (!resp.ok || !json2 || !json2.access_token) {
    const detail = json2 ? JSON.stringify(json2).slice(0, 300) : `HTTP ${resp.status}`;
    throw new Error("Zoho token refresh failed: " + detail);
  }
  const newExpiresAt = new Date(Date.now() + (Number(json2.expires_in) || 3600) * 1e3).toISOString();
  const newApiDomain = json2.api_domain || row.api_domain;
  await env.DB.prepare(
    "UPDATE zoho_oauth_tokens SET access_token = ?, access_token_expires_at = ?, api_domain = COALESCE(?, api_domain), updated_at = ? WHERE org_id = ?"
  ).bind(json2.access_token, newExpiresAt, newApiDomain, isoNow(), orgId).run();
  return { accessToken: json2.access_token, apiDomain: newApiDomain, mailApiDomain: zohoMailApiDomain(row.accounts_server), accountId: row.zoho_account_id, accountsServer: row.accounts_server };
}
__name(getZohoAccessToken, "getZohoAccessToken");
__name2(getZohoAccessToken, "getZohoAccessToken");
async function zohoApiFetch(env, orgId, path, options) {
  const opts = options || {};
  const tok = await getZohoAccessToken(env, orgId);
  const resp = await fetch(`${tok.mailApiDomain}${path}`, {
    method: opts.method || "GET",
    headers: Object.assign(
      { "Authorization": `Zoho-oauthtoken ${tok.accessToken}` },
      opts.json ? { "Content-Type": "application/json" } : {},
      opts.headers || {}
    ),
    body: opts.json ? JSON.stringify(opts.json) : opts.body
  });
  let body = null;
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    body = await resp.json().catch(() => null);
  }
  return { ok: resp.ok, status: resp.status, body, raw: ct.includes("application/json") ? null : resp };
}
__name(zohoApiFetch, "zohoApiFetch");
__name2(zohoApiFetch, "zohoApiFetch");
async function handleZohoOAuthStart(request, env, user) {
  if (!user.isOwner) return errorResponse("Forbidden: only Owner/Admin can connect Zoho Mail", 403);
  if (!env.ZOHO_CLIENT_ID) return errorResponse("Zoho OAuth is not configured", 503);
  const state = genId("zst").slice(0, 40);
  await env.DB.prepare(
    "INSERT INTO zoho_oauth_state (state, org_id, created_by, created_at) VALUES (?, ?, ?, ?)"
  ).bind(state, user.orgId, user.email || user.id || null, isoNow()).run();
  const redirectUri = "https://crm.sereneop.com/zoho/oauth/callback";
  const authUrl = "https://accounts.zoho.com/oauth/v2/auth?" + new URLSearchParams({
    scope: ZOHO_SCOPES,
    client_id: env.ZOHO_CLIENT_ID,
    response_type: "code",
    access_type: "offline",
    redirect_uri: redirectUri,
    state,
    prompt: "consent"
  }).toString();
  return Response.redirect(authUrl, 302);
}
__name(handleZohoOAuthStart, "handleZohoOAuthStart");
__name2(handleZohoOAuthStart, "handleZohoOAuthStart");
async function handleZohoOAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const accountsServerRaw = url.searchParams.get("accounts-server");
  const errorParam = url.searchParams.get("error");
  if (errorParam) {
    return Response.redirect(`https://crm.sereneop.com/?zoho=error&reason=${encodeURIComponent(errorParam)}`, 302);
  }
  if (!code || !state) {
    return Response.redirect("https://crm.sereneop.com/?zoho=error&reason=missing_code_or_state", 302);
  }
  const stateRow = await env.DB.prepare("SELECT * FROM zoho_oauth_state WHERE state = ?").bind(state).first();
  if (!stateRow) {
    return Response.redirect("https://crm.sereneop.com/?zoho=error&reason=invalid_state", 302);
  }
  await env.DB.prepare("DELETE FROM zoho_oauth_state WHERE state = ?").bind(state).run();
  const stateAgeMs = Date.now() - new Date(stateRow.created_at).getTime();
  if (!Number.isFinite(stateAgeMs) || stateAgeMs > 10 * 60 * 1e3) {
    return Response.redirect("https://crm.sereneop.com/?zoho=error&reason=expired_state", 302);
  }
  const accountsServer = accountsServerRaw ? accountsServerRaw.replace(/\/$/, "") : "https://accounts.zoho.com";
  if (!env.ZOHO_CLIENT_ID || !env.ZOHO_CLIENT_SECRET) {
    return Response.redirect("https://crm.sereneop.com/?zoho=error&reason=not_configured", 302);
  }
  const redirectUri = "https://crm.sereneop.com/zoho/oauth/callback";
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    redirect_uri: redirectUri,
    code
  });
  const tokenResp = await fetch(`${accountsServer}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString()
  });
  const tokenJson = await tokenResp.json().catch(() => null);
  if (!tokenResp.ok || !tokenJson || !tokenJson.access_token) {
    console.error("Zoho token exchange failed", tokenJson);
    return Response.redirect("https://crm.sereneop.com/?zoho=error&reason=token_exchange_failed", 302);
  }
  const apiDomain = tokenJson.api_domain || accountsServer;
  const expiresAt = new Date(Date.now() + (Number(tokenJson.expires_in) || 3600) * 1e3).toISOString();
  let zohoAccountId = null, zohoEmail = null;
  try {
    const acctResp = await fetch(`${zohoMailApiDomain(accountsServer)}/api/accounts`, {
      headers: { "Authorization": `Zoho-oauthtoken ${tokenJson.access_token}` }
    });
    const acctJson = await acctResp.json().catch(() => null);
    const first = acctJson && Array.isArray(acctJson.data) ? acctJson.data[0] : null;
    if (first) {
      zohoAccountId = first.accountId || null;
      zohoEmail = first.primaryEmailAddress || first.mailboxAddress || null;
    }
  } catch (e) {
    console.error("Zoho account lookup after OAuth failed", e.message);
  }
  const now = isoNow();
  await env.DB.prepare(
    `INSERT INTO zoho_oauth_tokens (org_id, accounts_server, api_domain, zoho_account_id, zoho_email, access_token, refresh_token, access_token_expires_at, scope, connected_by, connected_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id) DO UPDATE SET
       accounts_server = excluded.accounts_server,
       api_domain = excluded.api_domain,
       zoho_account_id = excluded.zoho_account_id,
       zoho_email = excluded.zoho_email,
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       access_token_expires_at = excluded.access_token_expires_at,
       scope = excluded.scope,
       updated_at = excluded.updated_at`
  ).bind(
    stateRow.org_id,
    accountsServer,
    apiDomain,
    zohoAccountId,
    zohoEmail,
    tokenJson.access_token,
    tokenJson.refresh_token || null,
    expiresAt,
    tokenJson.scope || ZOHO_SCOPES,
    stateRow.created_by,
    now,
    now
  ).run();
  return Response.redirect("https://crm.sereneop.com/?zoho=connected", 302);
}
__name(handleZohoOAuthCallback, "handleZohoOAuthCallback");
__name2(handleZohoOAuthCallback, "handleZohoOAuthCallback");
async function handleZohoDisconnect(request, env, user) {
  if (!user.isOwner) return errorResponse("Forbidden: only Owner/Admin can disconnect Zoho Mail", 403);
  await env.DB.prepare("DELETE FROM zoho_oauth_tokens WHERE org_id = ?").bind(user.orgId).run();
  return json({ data: { ok: true } });
}
__name(handleZohoDisconnect, "handleZohoDisconnect");
__name2(handleZohoDisconnect, "handleZohoDisconnect");
async function handleZohoStatus(request, env, user) {
  const row = await getZohoOAuthRow(env, user.orgId);
  if (!row) return json({ data: { connected: false } });
  return json({ data: {
    connected: true,
    email: row.zoho_email,
    connectedBy: row.connected_by,
    connectedAt: row.connected_at
  } });
}
__name(handleZohoStatus, "handleZohoStatus");
__name2(handleZohoStatus, "handleZohoStatus");
async function requireZohoAccount(env, orgId) {
  const row = await getZohoOAuthRow(env, orgId);
  if (!row || !row.zoho_account_id) throw new Error("Zoho Mail is not connected");
  return row;
}
__name(requireZohoAccount, "requireZohoAccount");
__name2(requireZohoAccount, "requireZohoAccount");
async function handleZohoFolders(request, env, user) {
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/folders`);
    if (!result.ok) return errorResponse("Zoho folders request failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    return json({ data: result.body && result.body.data || [] });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoFolders, "handleZohoFolders");
__name2(handleZohoFolders, "handleZohoFolders");
async function handleZohoMessagesList(request, env, user) {
  const url = new URL(request.url);
  const folderId = url.searchParams.get("folderId");
  if (!folderId) return errorResponse("folderId is required", 400);
  const start = url.searchParams.get("start") || "1";
  const limit = url.searchParams.get("limit") || "25";
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const qs = new URLSearchParams({ folderId, start, limit, sortBy: "date", sortorder: "false" });
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/messages/view?${qs.toString()}`);
    if (!result.ok) return errorResponse("Zoho messages request failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    return json({ data: result.body && result.body.data || [] });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoMessagesList, "handleZohoMessagesList");
__name2(handleZohoMessagesList, "handleZohoMessagesList");
async function recordZohoSendAttribution(env, orgId, sentByEmail, contactId, folderId, responseData) {
  try {
    const d = responseData || {};
    const messageId = d.messageId || d.message_id || Array.isArray(d) && d[0] && (d[0].messageId || d[0].message_id);
    if (!messageId) return;
    const threadId = d.threadId || d.thread_id || null;
    const now = isoNow();
    const existing = await env.DB.prepare("SELECT * FROM zoho_mail_meta WHERE org_id = ? AND zoho_message_id = ?").bind(orgId, String(messageId)).first();
    if (existing) {
      await env.DB.prepare("UPDATE zoho_mail_meta SET sent_by_crm_user_id = ?, thread_id = COALESCE(?, thread_id), matched_contact_id = COALESCE(?, matched_contact_id), zoho_folder_id = COALESCE(?, zoho_folder_id), updated_at = ? WHERE org_id = ? AND zoho_message_id = ?").bind(sentByEmail, threadId, contactId || null, folderId || null, now, orgId, String(messageId)).run();
    } else {
      await env.DB.prepare("INSERT INTO zoho_mail_meta (id, org_id, zoho_message_id, zoho_folder_id, thread_id, matched_contact_id, sent_by_crm_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(genId("zmm"), orgId, String(messageId), folderId || null, threadId, contactId || null, sentByEmail, now, now).run();
    }
  } catch (e) {
  }
}
__name(recordZohoSendAttribution, "recordZohoSendAttribution");
__name2(recordZohoSendAttribution, "recordZohoSendAttribution");
async function handleZohoMailMetaList(request, env, user) {
  const url = new URL(request.url);
  const folderId = url.searchParams.get("folderId");
  const rows = folderId ? await env.DB.prepare("SELECT * FROM zoho_mail_meta WHERE org_id = ? AND zoho_folder_id = ?").bind(user.orgId, folderId).all() : await env.DB.prepare("SELECT * FROM zoho_mail_meta WHERE org_id = ?").bind(user.orgId).all();
  const data = {};
  (rows.results || []).forEach(function(r) {
    data[r.zoho_message_id] = {
      contactId: r.matched_contact_id || null,
      claimedBy: r.claimed_by || null,
      sentBy: r.sent_by_crm_user_id || null,
      threadId: r.thread_id || null,
      createdAt: r.created_at || null
    };
  });
  return json({ data });
}
__name(handleZohoMailMetaList, "handleZohoMailMetaList");
__name2(handleZohoMailMetaList, "handleZohoMailMetaList");
async function handleZohoMailMetaPatch(request, env, user, messageId) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }
  const now = isoNow();
  const existing = await env.DB.prepare("SELECT * FROM zoho_mail_meta WHERE org_id = ? AND zoho_message_id = ?").bind(user.orgId, messageId).first();
  const contactId = body && Object.prototype.hasOwnProperty.call(body, "contactId") ? body.contactId : existing ? existing.matched_contact_id : null;
  const claimedBy = body && Object.prototype.hasOwnProperty.call(body, "claimedBy") ? body.claimedBy : existing ? existing.claimed_by : null;
  const folderId = body && body.folderId || (existing ? existing.zoho_folder_id : null);
  if (existing) {
    await env.DB.prepare("UPDATE zoho_mail_meta SET matched_contact_id = ?, claimed_by = ?, zoho_folder_id = COALESCE(?, zoho_folder_id), updated_at = ? WHERE org_id = ? AND zoho_message_id = ?").bind(contactId, claimedBy, folderId, now, user.orgId, messageId).run();
  } else {
    await env.DB.prepare("INSERT INTO zoho_mail_meta (id, org_id, zoho_message_id, zoho_folder_id, matched_contact_id, claimed_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(genId("zmm"), user.orgId, messageId, folderId, contactId, claimedBy, now, now).run();
  }
  return json({ data: { messageId, contactId, claimedBy } });
}
__name(handleZohoMailMetaPatch, "handleZohoMailMetaPatch");
__name2(handleZohoMailMetaPatch, "handleZohoMailMetaPatch");
async function handleZohoMessageContent(request, env, user, folderId, messageId) {
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/folders/${folderId}/messages/${messageId}/content`);
    if (!result.ok) return errorResponse("Zoho message content request failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    const data = result.body && result.body.data || {};
    try {
      const attResult = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/folders/${folderId}/messages/${messageId}/attachmentinfo`);
      const attList = attResult.ok && attResult.body && attResult.body.data && attResult.body.data.attachments;
      if (Array.isArray(attList)) {
        data.attachments = attList;
      }
    } catch (attErr) {
    }
    return json({ data });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoMessageContent, "handleZohoMessageContent");
__name2(handleZohoMessageContent, "handleZohoMessageContent");
async function handleZohoMarkRead(request, env, user) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }
  if (!body || !Array.isArray(body.messageIds) || !body.messageIds.length) {
    return errorResponse("messageIds (array) is required", 400);
  }
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/updatemessage`, {
      method: "PUT",
      json: { mode: body.read === false ? "markAsUnread" : "markAsRead", messageId: body.messageIds }
    });
    if (!result.ok) return errorResponse("Zoho mark-read request failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    return json({ data: { ok: true } });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoMarkRead, "handleZohoMarkRead");
__name2(handleZohoMarkRead, "handleZohoMarkRead");
async function sendUserInvitationMail(actor,message){
  const row=await requireZohoAccount(this,actor.orgId);
  const result=await zohoApiFetch(this,actor.orgId,`/api/accounts/${row.zoho_account_id}/messages`,{method:'POST',json:{fromAddress:row.zoho_email,...message,mailFormat:'html',askReceipt:'no'}});
  if(!result.ok||result.body?.status?.code!==200)throw Error('Invitation mail was not confirmed by Zoho.');
}
async function handleZohoSend(request, env, user) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }
  if (!body || !body.toAddress || !body.subject) return errorResponse("toAddress and subject are required", 400);
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const payload = {
      fromAddress: row.zoho_email,
      toAddress: body.toAddress,
      ccAddress: body.ccAddress || void 0,
      bccAddress: body.bccAddress || void 0,
      subject: body.subject,
      content: body.content || "",
      askReceipt: "no"
    };
    if (Array.isArray(body.attachments) && body.attachments.length) {
      payload.attachments = body.attachments.filter(function(a) {
        return a && a.attachmentPath && a.storeName;
      }).map(function(a) {
        return { storeName: a.storeName, attachmentPath: a.attachmentPath, attachmentName: a.attachmentName || "attachment" };
      });
    }
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/messages`, { method: "POST", json: payload });
    if (!result.ok) return errorResponse("Zoho send failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    const sentData = result.body && result.body.data || { ok: true };
    await recordZohoSendAttribution(env, user.orgId, user.email || user.id || null, body.contactId || null, null, sentData);
    return json({ data: sentData });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoSend, "handleZohoSend");
__name2(handleZohoSend, "handleZohoSend");
async function handleZohoReplyOrForward(request, env, user, messageId) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }
  const mode = body && body.mode;
  if (!["reply", "replyall", "forward"].includes(mode)) {
    return errorResponse("mode must be one of reply, replyall, forward", 400);
  }
  if (!body.toAddress) return errorResponse("toAddress is required", 400);
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const payload = {
      fromAddress: row.zoho_email,
      toAddress: body.toAddress,
      ccAddress: body.ccAddress || void 0,
      bccAddress: body.bccAddress || void 0,
      subject: body.subject || (mode === "forward" ? "Fwd: (no subject)" : "Re: (no subject)"),
      content: body.content || "",
      askReceipt: "no",
      action: "reply"
    };
    if (Array.isArray(body.attachments) && body.attachments.length) {
      payload.attachments = body.attachments.filter(function(a) {
        return a && a.attachmentPath && a.storeName;
      }).map(function(a) {
        return { storeName: a.storeName, attachmentPath: a.attachmentPath, attachmentName: a.attachmentName || "attachment" };
      });
    }
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/messages/${messageId}`, { method: "POST", json: payload });
    if (!result.ok) return errorResponse("Zoho reply/forward failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    const rfData = result.body && result.body.data || { ok: true };
    await recordZohoSendAttribution(env, user.orgId, user.email || user.id || null, body.contactId || null, null, rfData);
    return json({ data: rfData });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoReplyOrForward, "handleZohoReplyOrForward");
__name2(handleZohoReplyOrForward, "handleZohoReplyOrForward");
async function zohoCarryOverAttachment(env, orgId, accountId, item) {
  try {
    const tok = await getZohoAccessToken(env, orgId);
    const dlResp = await fetch(
      `${tok.mailApiDomain}/api/accounts/${accountId}/folders/${item.folderId}/messages/${item.messageId}/attachments/${item.attachmentId}`,
      { headers: { "Authorization": `Zoho-oauthtoken ${tok.accessToken}` } }
    );
    if (!dlResp.ok) return null;
    const bytes = await dlResp.arrayBuffer();
    const fileName = item.attachmentName || "attachment";
    const upResp = await fetch(
      `${tok.mailApiDomain}/api/accounts/${accountId}/messages/attachments?${new URLSearchParams({ fileName, isInline: "false" }).toString()}`,
      { method: "POST", headers: { "Authorization": `Zoho-oauthtoken ${tok.accessToken}`, "Content-Type": "application/octet-stream" }, body: bytes }
    );
    const upJson = await upResp.json().catch(() => null);
    if (!upResp.ok || !upJson || !upJson.data) return null;
    return { storeName: upJson.data.storeName, attachmentPath: upJson.data.attachmentPath, attachmentName: fileName };
  } catch (e) {
    return null;
  }
}
__name(zohoCarryOverAttachment, "zohoCarryOverAttachment");
__name2(zohoCarryOverAttachment, "zohoCarryOverAttachment");
async function handleZohoDraftSave(request, env, user) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }
  if (!body || !body.toAddress) return errorResponse("toAddress is required", 400);
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const payload = {
      mode: "draft",
      fromAddress: row.zoho_email,
      toAddress: body.toAddress,
      ccAddress: body.ccAddress || void 0,
      bccAddress: body.bccAddress || void 0,
      subject: body.subject || "(No subject)",
      content: body.content || "",
      mailFormat: "html"
    };
    const attList = [];
    if (Array.isArray(body.attachments) && body.attachments.length) {
      body.attachments.filter(function(a) {
        return a && a.attachmentPath && a.storeName;
      }).forEach(function(a) {
        attList.push({ storeName: a.storeName, attachmentPath: a.attachmentPath, attachmentName: a.attachmentName || "attachment" });
      });
    }
    if (Array.isArray(body.keepAttachments) && body.keepAttachments.length) {
      const carried = await Promise.all(body.keepAttachments.filter(function(a) {
        return a && a.folderId && a.messageId && a.attachmentId;
      }).map(function(a) {
        return zohoCarryOverAttachment(env, user.orgId, row.zoho_account_id, a);
      }));
      carried.filter(Boolean).forEach(function(a) {
        attList.push(a);
      });
    }
    if (attList.length) payload.attachments = attList;
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/messages`, { method: "POST", json: payload });
    if (!result.ok) return errorResponse("Zoho draft save failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    const draftData = result.body && result.body.data || {};
    if (body.draftId && body.draftFolderId && String(body.draftId) !== String(draftData.messageId)) {
      try {
        await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/folders/${body.draftFolderId}/messages/${body.draftId}`, { method: "DELETE" });
      } catch (delErr) {
      }
    }
    return json({ data: draftData });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoDraftSave, "handleZohoDraftSave");
__name2(handleZohoDraftSave, "handleZohoDraftSave");
async function handleZohoDraftSend(request, env, user) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }
  if (!body || !body.toAddress || !body.subject) return errorResponse("toAddress and subject are required", 400);
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const payload = {
      fromAddress: row.zoho_email,
      toAddress: body.toAddress,
      ccAddress: body.ccAddress || void 0,
      bccAddress: body.bccAddress || void 0,
      subject: body.subject,
      content: body.content || "",
      askReceipt: "no"
    };
    const attList2 = [];
    if (Array.isArray(body.attachments) && body.attachments.length) {
      body.attachments.filter(function(a) {
        return a && a.attachmentPath && a.storeName;
      }).forEach(function(a) {
        attList2.push({ storeName: a.storeName, attachmentPath: a.attachmentPath, attachmentName: a.attachmentName || "attachment" });
      });
    }
    if (Array.isArray(body.keepAttachments) && body.keepAttachments.length) {
      const carried2 = await Promise.all(body.keepAttachments.filter(function(a) {
        return a && a.folderId && a.messageId && a.attachmentId;
      }).map(function(a) {
        return zohoCarryOverAttachment(env, user.orgId, row.zoho_account_id, a);
      }));
      carried2.filter(Boolean).forEach(function(a) {
        attList2.push(a);
      });
    }
    if (attList2.length) payload.attachments = attList2;
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/messages`, { method: "POST", json: payload });
    if (!result.ok) return errorResponse("Zoho draft send failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    const sentData = result.body && result.body.data || { ok: true };
    if (body.draftId && body.draftFolderId) {
      try {
        await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/folders/${body.draftFolderId}/messages/${body.draftId}`, { method: "DELETE" });
      } catch (delErr) {
      }
    }
    await recordZohoSendAttribution(env, user.orgId, user.email || user.id || null, body.contactId || null, null, sentData);
    return json({ data: sentData });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoDraftSend, "handleZohoDraftSend");
__name2(handleZohoDraftSend, "handleZohoDraftSend");
async function handleZohoDraftDelete(request, env, user, folderId, draftId) {
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/folders/${folderId}/messages/${draftId}`, { method: "DELETE" });
    if (!result.ok) return errorResponse("Zoho draft delete failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    return json({ data: { ok: true } });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoDraftDelete, "handleZohoDraftDelete");
__name2(handleZohoDraftDelete, "handleZohoDraftDelete");
async function handleZohoThreadGet(request, env, user) {
  const url = new URL(request.url);
  const threadId = url.searchParams.get("threadId");
  if (!threadId) return errorResponse("threadId is required", 400);
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const foldersResult = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/folders`);
    const folders = foldersResult.ok && foldersResult.body && foldersResult.body.data || [];
    const mainFolders = folders.filter(function(f) {
      return ["Inbox", "Sent", "Drafts"].indexOf(f.folderType) > -1;
    });
    const perFolder = await Promise.all(mainFolders.map(async function(f) {
      const qs = new URLSearchParams({ folderId: f.folderId, start: "1", limit: "200", sortBy: "date", sortorder: "false" });
      const r = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/messages/view?${qs.toString()}`);
      const rows = r.ok && r.body && r.body.data || [];
      return rows.filter(function(m) {
        return String(m.threadId) === String(threadId) || String(m.messageId) === String(threadId);
      });
    }));
    const merged = [].concat.apply([], perFolder);
    merged.sort(function(a, b) {
      return Number(a.receivedTime || 0) - Number(b.receivedTime || 0);
    });
    return json({ data: merged, mailboxEmail: row.zoho_email });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoThreadGet, "handleZohoThreadGet");
__name2(handleZohoThreadGet, "handleZohoThreadGet");
async function handleZohoAttachmentDownload(request, env, user, folderId, messageId, attachmentId) {
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const tok = await getZohoAccessToken(env, user.orgId);
    const resp = await fetch(
      `${tok.mailApiDomain}/api/accounts/${row.zoho_account_id}/folders/${folderId}/messages/${messageId}/attachments/${attachmentId}`,
      { headers: { "Authorization": `Zoho-oauthtoken ${tok.accessToken}` } }
    );
    if (!resp.ok) return errorResponse("Zoho attachment download failed", 502);
    return new Response(resp.body, {
      status: 200,
      headers: {
        "Content-Type": resp.headers.get("content-type") || "application/octet-stream",
        "Content-Disposition": resp.headers.get("content-disposition") || "attachment"
      }
    });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoAttachmentDownload, "handleZohoAttachmentDownload");
__name2(handleZohoAttachmentDownload, "handleZohoAttachmentDownload");
async function handleZohoAttachmentUpload(request, env, user) {
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const tok = await getZohoAccessToken(env, user.orgId);
    const reqUrl = new URL(request.url);
    const fileName = reqUrl.searchParams.get("fileName") || "attachment";
    const attachQs = new URLSearchParams({ fileName, isInline: "false" });
    const resp = await fetch(`${tok.mailApiDomain}/api/accounts/${row.zoho_account_id}/messages/attachments?${attachQs.toString()}`, {
      method: "POST",
      headers: { "Authorization": `Zoho-oauthtoken ${tok.accessToken}`, "Content-Type": "application/octet-stream" },
      body: request.body
    });
    const respJson = await resp.json().catch(() => null);
    if (!resp.ok) return errorResponse("Zoho attachment upload failed: " + JSON.stringify(respJson).slice(0, 300), 502);
    return json({ data: respJson && respJson.data || null });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoAttachmentUpload, "handleZohoAttachmentUpload");
__name2(handleZohoAttachmentUpload, "handleZohoAttachmentUpload");
var STAGING_FRONTEND_ORIGIN = "https://zoom-zoho-integration.serene-ops-crm.pages.dev";
async function proxyStagingFrontend(request, url, env) {
  const target = STAGING_FRONTEND_ORIGIN + url.pathname + url.search;
  const headers = new Headers(request.headers);
  headers.delete("Cookie");
  headers.delete("cf-access-jwt-assertion");
  if (env && env.STAGING_PAGES_ACCESS_CLIENT_ID && env.STAGING_PAGES_ACCESS_CLIENT_SECRET) {
    headers.set("CF-Access-Client-Id", env.STAGING_PAGES_ACCESS_CLIENT_ID);
    headers.set("CF-Access-Client-Secret", env.STAGING_PAGES_ACCESS_CLIENT_SECRET);
  }
  try {
    const upstreamResp = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? void 0 : request.body,
      redirect: "manual"
    });
    if (upstreamResp.status >= 300 && upstreamResp.status < 400 || upstreamResp.status === 401 || upstreamResp.status === 403) {
      return errorResponse(
        "Staging proxy misconfigured: the Worker's request to the staging frontend was rejected by Cloudflare Access (status " + upstreamResp.status + "). The STAGING_PAGES_ACCESS_CLIENT_ID / STAGING_PAGES_ACCESS_CLIENT_SECRET Worker secrets are missing, wrong, or not yet authorized by the pages.dev app's Service Auth policy. See worker/README.md.",
        502
      );
    }
    const proxied = new Response(upstreamResp.body, upstreamResp);
    proxied.headers.delete("Set-Cookie");
    return proxied;
  } catch (err) {
    return errorResponse("Staging frontend proxy failed: " + err.message, 502);
  }
}
__name(proxyStagingFrontend, "proxyStagingFrontend");
__name2(proxyStagingFrontend, "proxyStagingFrontend");
var worker_default = { async fetch(e, r, t) {
  const _stagingUrl = new URL(e.url);
  const s = _stagingUrl.pathname;
  if ("OPTIONS" === e.method) return new Response(null, { status: 204, headers: corsHeaders(e) });
  if ("/api/health" === s) return withCors(json({ status: "ok", time: isoNow() }), e);
  if ("/zoom/webhook" === s) return handleZoomWebhook(e, r);
  if ("/zoho/oauth/callback" === s) return handleZohoOAuthCallback(e, r);
  if (_stagingUrl.hostname === "staging-crm.sereneop.com" && !s.startsWith("/api/") && !s.startsWith("/cdn-cgi/")) {
    return proxyStagingFrontend(e, _stagingUrl, r);
  }
  if (!s.startsWith("/api/")) return errorResponse("Not found", 404);
  const o = await verifyAccessJwt(e, r);
  if (!o.ok) return withCors(errorResponse(o.error, o.status), e);
  const n = await resolveUser(r, o.email);
  if (!n) return withCors(errorResponse("No active CRM account found for this Access identity. Contact the Owner/Admin.", 403), e);
  if(s==='/api/users'||s.startsWith('/api/users/'))return withCors(await handleUsers(e,r,n,{sendMail:sendUserInvitationMail.bind(r)}),e);
  if(!n.isOwner&&!allowedStaffRoute(s,e.method,n))return withCors(errorResponse('This section is outside your assigned access. Your assigned work is available in the CRM.',403),e);
  if(s==='/api/contact-archive')return withCors(await handleContactArchive(e,r,n),e);
  if(s.startsWith('/api/sales/contacts/'))return withCors(await handleSalesContactAutosave(e,r,n),e);
  if(s==='/api/call-queue'||s.startsWith('/api/call-queue/'))return withCors(await handleCallQueue(e,r,n),e);
  if(s.startsWith('/api/audit-connectors/'))return withCors(await handleAuditConnectors(e,r,n),e);
  if(s==='/api/audits'||s.startsWith('/api/audits/'))return withCors(await handleAudits(e,r,n,t),e);
  const a = s.replace(/^\/api\//, "").split("/").filter(Boolean), i = a[0], d = a[1];
  if ("auth" === i) {
    return withCors(await handleAuthRequest(e, r, n, d), e);
  }
  if ("/api/db" === s) {
    return withCors(await handleDbBlobRequest(e, r, n, t), e);
  }
  if ("/api/me" === s) {
    const t2 = await r.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(n.id).first();
    return withCors(meResponse(n, t2 && t2.password_hash), e);
  }
  if ("/api/zoho/oauth/start" === s && "GET" === e.method) {
    return await handleZohoOAuthStart(e, r, n);
  }
  if ("/api/zoho/disconnect" === s && "POST" === e.method) {
    return withCors(await handleZohoDisconnect(e, r, n), e);
  }
  if ("/api/zoho/status" === s && "GET" === e.method) {
    return withCors(await handleZohoStatus(e, r, n), e);
  }
  if ("/api/zoho/mail/folders" === s && "GET" === e.method) {
    return withCors(await handleZohoFolders(e, r, n), e);
  }
  if ("/api/zoho/mail/messages" === s && "GET" === e.method) {
    return withCors(await handleZohoMessagesList(e, r, n), e);
  }
  if ("/api/zoho/mail/messages/mark-read" === s && "PUT" === e.method) {
    return withCors(await handleZohoMarkRead(e, r, n), e);
  }
  if ("/api/zoho/mail/send" === s && "POST" === e.method) {
    return withCors(await handleZohoSend(e, r, n), e);
  }
  if ("/api/zoho/mail/meta" === s && "GET" === e.method) {
    return withCors(await handleZohoMailMetaList(e, r, n), e);
  }
  if (s.startsWith("/api/zoho/mail/meta/") && "PATCH" === e.method) {
    const metaMsgId = s.slice("/api/zoho/mail/meta/".length);
    if (!metaMsgId) return withCors(errorResponse("Not found", 404), e);
    return withCors(await handleZohoMailMetaPatch(e, r, n, metaMsgId), e);
  }
  if (s.startsWith("/api/zoho/mail/messages/") && s.endsWith("/action") && "POST" === e.method) {
    const parts0 = s.split("/");
    const messageId0 = parts0[5];
    if (!messageId0) return withCors(errorResponse("Not found", 404), e);
    return withCors(await handleZohoReplyOrForward(e, r, n, messageId0), e);
  }
  if (s.startsWith("/api/zoho/mail/attachments/") && "GET" === e.method) {
    const parts1 = s.slice("/api/zoho/mail/attachments/".length).split("/");
    const [folderId1, messageId1, attachmentId1] = parts1;
    if (!folderId1 || !messageId1 || !attachmentId1) return withCors(errorResponse("Not found", 404), e);
    return await handleZohoAttachmentDownload(e, r, n, folderId1, messageId1, attachmentId1);
  }
  if ("/api/zoho/mail/attachments/upload" === s && "POST" === e.method) {
    return withCors(await handleZohoAttachmentUpload(e, r, n), e);
  }
  if (s.startsWith("/api/zoho/mail/messages/") && "GET" === e.method) {
    const parts2 = s.slice("/api/zoho/mail/messages/".length).split("/");
    const [folderId2, messageId2] = parts2;
    if (!folderId2 || !messageId2) return withCors(errorResponse("Not found", 404), e);
    return withCors(await handleZohoMessageContent(e, r, n, folderId2, messageId2), e);
  }
  if ("/api/zoho/mail/draft" === s && "POST" === e.method) {
    return withCors(await handleZohoDraftSave(e, r, n), e);
  }
  if ("/api/zoho/mail/draft/send" === s && "POST" === e.method) {
    return withCors(await handleZohoDraftSend(e, r, n), e);
  }
  if ("/api/zoho/mail/thread" === s && "GET" === e.method) {
    return withCors(await handleZohoThreadGet(e, r, n), e);
  }
  if (s.startsWith("/api/zoho/mail/draft/") && "DELETE" === e.method) {
    const draftParts = s.slice("/api/zoho/mail/draft/".length).split("/");
    const [draftFolderId3, draftId3] = draftParts;
    if (!draftFolderId3 || !draftId3) return withCors(errorResponse("Not found", 404), e);
    return withCors(await handleZohoDraftDelete(e, r, n, draftFolderId3, draftId3), e);
  }
  if ("/api/zoom/diagnostics" === s && "GET" === e.method) {
    return withCors(await handleZoomDiagnostics(r), e);
  }
  if ("/api/zoom/phone-mapping" === s) {
    return withCors(await handleZoomPhoneMapping(e, r, n), e);
  }
  if ("/api/zoom/calls" === s && "GET" === e.method) {
    return withCors(await handleZoomCallsList(e, r, n), e);
  }
  if ("/api/zoom/calls/claim" === s && "POST" === e.method) {
    return withCors(await handleZoomCallClaim(e, r, n), e);
  }
  if ("/api/zoom/call-history-check" === s && "GET" === e.method) {
    return withCors(await handleZoomCallHistoryCheck(e, r, n), e);
  }
  if (s.startsWith("/api/zoom/meetings/") && "PATCH" === e.method) {
    const zoomMeetingId = s.slice("/api/zoom/meetings/".length);
    if (!zoomMeetingId) return withCors(errorResponse("Not found", 404), e);
    return withCors(await handleZoomMeetingPatch(e, r, n, zoomMeetingId), e);
  }
  if ("/api/zoom/phone-users" === s && "GET" === e.method) {
    if (!n.isOwner) return withCors(errorResponse("Forbidden: only Owner/Admin can list Zoom Phone users", 403), e);
    return withCors(json(await handleZoomPhoneUsers(r)), e);
  }
  if (s.startsWith("/api/zoom/diagnostics/meeting-instances/") && "GET" === e.method) {
    if (!n.isOwner) return withCors(errorResponse("Forbidden: only Owner/Admin can run this", 403), e);
    const meetingId = s.slice("/api/zoom/diagnostics/meeting-instances/".length);
    if (!meetingId) return withCors(errorResponse("Not found", 404), e);
    try {
      const result = await zoomApiGet(r, `/past_meetings/${meetingId}/instances`);
      return withCors(json({ data: result }), e);
    } catch (err) {
      return withCors(errorResponse("Zoom API call failed: " + err.message, 502), e);
    }
  }
  if ("/api/zoom/diagnostics/backfill-meeting-sync" === s && "POST" === e.method) {
    if (!n.isOwner) return withCors(errorResponse("Forbidden: only Owner/Admin can run this", 403), e);
    return withCors(json(await backfillMeetingSyncFromLedger(r, n.orgId)), e);
  }
  if ("/api/zoho/diagnostics/accounts-raw" === s && "GET" === e.method) {
    if (!n.isOwner) return withCors(errorResponse("Forbidden: only Owner/Admin can run this", 403), e);
    try {
      const tok = await getZohoAccessToken(r, n.orgId);
      const hostOverride = new URL(e.url).searchParams.get("host");
      const baseHost = hostOverride || tok.mailApiDomain;
      const resp = await fetch(`${baseHost}/api/accounts`, { headers: { "Authorization": `Zoho-oauthtoken ${tok.accessToken}` } });
      const bodyText = await resp.text();
      return withCors(json({ status: resp.status, baseHost, body: bodyText.slice(0, 4e3) }), e);
    } catch (err) {
      return withCors(errorResponse("Zoho accounts lookup failed: " + err.message, 502), e);
    }
  }
  if ("/api/zoho/diagnostics/backfill-account-info" === s && "POST" === e.method) {
    if (!n.isOwner) return withCors(errorResponse("Forbidden: only Owner/Admin can run this", 403), e);
    try {
      const tok = await getZohoAccessToken(r, n.orgId);
      const resp = await fetch(`${tok.mailApiDomain}/api/accounts`, { headers: { "Authorization": `Zoho-oauthtoken ${tok.accessToken}` } });
      const acctJson = await resp.json().catch(() => null);
      const list = acctJson && (Array.isArray(acctJson.data) ? acctJson.data : Array.isArray(acctJson) ? acctJson : null);
      const first = list && list[0];
      if (!first) return withCors(errorResponse("Zoho accounts response had no usable account entry: " + JSON.stringify(acctJson).slice(0, 300), 502), e);
      const accountId = first.accountId || first.account_id || null;
      const email = first.primaryEmailAddress || first.mailboxAddress || first.mailBoxAddress || first.emailAddress || first.email || null;
      if (!accountId) return withCors(errorResponse("Could not find accountId in Zoho response: " + JSON.stringify(first).slice(0, 300), 502), e);
      await r.DB.prepare("UPDATE zoho_oauth_tokens SET zoho_account_id = ?, zoho_email = ?, updated_at = ? WHERE org_id = ?").bind(accountId, email, isoNow(), n.orgId).run();
      return withCors(json({ data: { accountId, email } }), e);
    } catch (err) {
      return withCors(errorResponse("Zoho account backfill failed: " + err.message, 502), e);
    }
  }
  if (RESOURCES[i]) {
    return withCors(await handleResourceRequest(e, r, n, i, d), e);
  }
  return withCors(errorResponse("Not found", 404), e);
}, async scheduled(event, env, ctx) {
  if (event.cron === "*/15 * * * *") {
    ctx.waitUntil(resumeAuditQueue(env).catch(e=>console.error("Audit queue unavailable",e.message)));
    ctx.waitUntil(runAutomationsEngine(env).catch(function(e) {
      console.error("automations engine failed", e.message);
      return logSystemAlert(env, "Automations engine", e.message);
    }));
    return;
  }
  ctx.waitUntil(runNightlyBackup(env).catch(function(e) {
    console.error("nightly backup failed", e.message);
    return logSystemAlert(env, "Nightly backup", e.message);
  }));
  ctx.waitUntil(runContractDeadlineCheck(env).catch(function(e) {
    console.error("contract deadline check failed", e.message);
    return logSystemAlert(env, "Contract deadline check", e.message);
  }));
  ctx.waitUntil(runWeeklyCallPackDrafts(env).catch(function(e) {
    console.error("weekly call pack draft failed", e.message);
    return logSystemAlert(env, "Weekly call pack drafts", e.message);
  }));
  ctx.waitUntil(runAutomationsEngine(env).catch(function(e) {
    console.error("automations engine failed", e.message);
    return logSystemAlert(env, "Automations engine", e.message);
  }));
} };
export {
  worker_default as default,
  handleResourceRequest,
  handleAuthRequest,
  handleDbBlobRequest,
  handleZoomCallClaim,
  handleZoomPhoneMapping,
  loadSnapshotData,
  matchContactByPhone,
  mutateOrgSnapshot,
  runContractDeadlineCheck,
  runWeeklyCallPackDrafts,
  runAutomationsEngine,
  logSystemAlert
};
//# sourceMappingURL=worker.js.map
