// Kick resmi Public API istemcisi
// Dokumantasyon: https://docs.kick.com
import crypto from "crypto";
import * as store from "./store.js";

const ID_BASE = "https://id.kick.com";
const API_BASE = "https://api.kick.com";

export const SCOPES = [
  "user:read",
  "channel:read",
  "chat:write",
  "events:subscribe",
  "moderation:ban",
  "moderation:chat_message:manage",
].join(" ");

// ---------- OAuth (PKCE) ----------

const pkceBellek = new Map(); // state -> code_verifier

export function authUrlOlustur() {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");
  pkceBellek.set(state, verifier);
  setTimeout(() => pkceBellek.delete(state), 10 * 60 * 1000);

  const p = new URLSearchParams({
    response_type: "code",
    client_id: process.env.KICK_CLIENT_ID,
    redirect_uri: process.env.KICK_REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${ID_BASE}/oauth/authorize?${p.toString()}`;
}

export async function kodDegistir(code, state) {
  const verifier = pkceBellek.get(state);
  if (!verifier) throw new Error("Gecersiz veya suresi dolmus state. /auth adresinden tekrar basla.");
  pkceBellek.delete(state);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.KICK_CLIENT_ID,
    client_secret: process.env.KICK_CLIENT_SECRET,
    redirect_uri: process.env.KICK_REDIRECT_URI,
    code_verifier: verifier,
    code,
  });

  const r = await fetch(`${ID_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`Token alinamadi (${r.status}): ${await r.text()}`);
  const t = await r.json();
  tokenKaydet(t);
  return t;
}

function tokenKaydet(t) {
  const db = store.get();
  db.tokens = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    // 60 sn erken yenile
    expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000 - 60000,
  };
  store.kaydet();
}

async function tokenYenile() {
  const db = store.get();
  if (!db.tokens?.refresh_token) throw new Error("Refresh token yok. /auth adresinden yeniden giris yap.");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.KICK_CLIENT_ID,
    client_secret: process.env.KICK_CLIENT_SECRET,
    refresh_token: db.tokens.refresh_token,
  });

  const r = await fetch(`${ID_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`Token yenilenemedi (${r.status}): ${await r.text()}`);
  tokenKaydet(await r.json());
  console.log("[kick] Token yenilendi.");
}

export function girisYapildiMi() {
  return Boolean(store.get().tokens?.access_token);
}

async function accessToken() {
  const db = store.get();
  if (!db.tokens?.access_token) throw new Error("GIRIS_YOK");
  if (Date.now() >= (db.tokens.expires_at || 0)) await tokenYenile();
  return store.get().tokens.access_token;
}

// ---------- Genel istek yardimcisi ----------

async function api(method, yol, { body, query } = {}, tekrar = true) {
  const token = await accessToken();
  const url = new URL(API_BASE + yol);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.append(k, v);

  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (r.status === 401 && tekrar) {
    await tokenYenile();
    return api(method, yol, { body, query }, false);
  }

  const metin = await r.text();
  if (!r.ok) throw new Error(`Kick API ${method} ${yol} -> ${r.status}: ${metin}`);
  try {
    return metin ? JSON.parse(metin) : {};
  } catch {
    return {};
  }
}

// ---------- Uc noktalar ----------

export async function kanalBilgisi(slug) {
  const j = await api("GET", "/public/v1/channels", { query: { slug } });
  return j?.data?.[0] || null; // { broadcaster_user_id, slug, ... }
}

export async function benKimim() {
  const j = await api("GET", "/public/v1/users");
  return j?.data?.[0] || null; // { user_id, name, ... }
}

export async function mesajGonder(broadcasterUserId, icerik, tip = "user", replyToMessageId = null) {
  // Kick sadece "user" veya "bot" kabul eder. Baska bir sey yazilmissa "user"a cevir.
  let mesajTipi = tip === "bot" ? "bot" : "user";

  const govdeOlustur = (t) => {
    const body = { type: t, content: String(icerik).slice(0, 500) };
    // ONEMLI: "bot" tipinde broadcaster_user_id GONDERILMEZ.
    // "user" tipinde ZORUNLUDUR.
    if (t === "user") body.broadcaster_user_id = broadcasterUserId;
    if (replyToMessageId) body.reply_to_message_id = replyToMessageId;
    return body;
  };

  try {
    return await api("POST", "/public/v1/chat", { body: govdeOlustur(mesajTipi) });
  } catch (e) {
    // "bot" tipi Kick tarafinda sik sik hata veriyor -> "user" ile tekrar dene
    if (mesajTipi === "bot") {
      console.warn("[kick] 'bot' tipi basarisiz, 'user' tipiyle tekrar deneniyor...");
      return api("POST", "/public/v1/chat", { body: govdeOlustur("user") });
    }
    throw e;
  }
}

export async function mesajSil(messageId) {
  return api("DELETE", `/public/v1/chat/${messageId}`);
}

// sureDakika verilmezse KALICI BAN olur (1 - 10080 dakika arasi = timeout)
export async function banla(broadcasterUserId, userId, sureDakika = null, sebep = null) {
  const body = { broadcaster_user_id: broadcasterUserId, user_id: userId };
  if (sureDakika) body.duration = Math.min(Math.max(Math.round(sureDakika), 1), 10080);
  if (sebep) body.reason = String(sebep).slice(0, 100);
  return api("POST", "/public/v1/moderation/bans", { body });
}

export async function banKaldir(broadcasterUserId, userId) {
  return api("DELETE", "/public/v1/moderation/bans", {
    body: { broadcaster_user_id: broadcasterUserId, user_id: userId },
  });
}

export async function olaylaraAbone(broadcasterUserId) {
  const body = {
    method: "webhook",
    broadcaster_user_id: broadcasterUserId,
    events: [
      { name: "chat.message.sent", version: 1 },
      { name: "channel.followed", version: 1 },
      { name: "channel.subscription.new", version: 1 },
      { name: "channel.subscription.renewal", version: 1 },
      { name: "livestream.status.updated", version: 1 },
    ],
  };
  return api("POST", "/public/v1/events/subscriptions", { body });
}

export async function abonelikleriListele() {
  return api("GET", "/public/v1/events/subscriptions");
}

export async function abonelikleriSil(idler) {
  if (!idler?.length) return {};
  const q = idler.map((i) => `id=${encodeURIComponent(i)}`).join("&");
  return api("DELETE", `/public/v1/events/subscriptions?${q}`);
}

// Kanal degistirilirken: eski abonelikleri sil, yeni kanala abone ol
export async function abonelikleriYenile(broadcasterUserId) {
  try {
    const mevcut = await abonelikleriListele();
    const idler = (mevcut?.data || []).map((s) => s.id).filter(Boolean);
    if (idler.length) await abonelikleriSil(idler);
  } catch (e) {
    console.warn("[kick] Eski abonelikler silinemedi:", e.message);
  }
  return olaylaraAbone(broadcasterUserId);
}

// ---------- Webhook imza dogrulama ----------

const KICK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8
6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2
MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ
L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY
6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF
BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e
twIDAQAB
-----END PUBLIC KEY-----`;

// Kick imzayi soyle olusturur: "<message-id>.<timestamp>.<ham govde>" -> RSA-SHA256 imza (base64)
export function imzaDogrula(headers, rawBody) {
  try {
    const messageId = headers["kick-event-message-id"];
    const timestamp = headers["kick-event-message-timestamp"];
    const signature = headers["kick-event-signature"];
    if (!messageId || !timestamp || !signature) return false;

    const veri = `${messageId}.${timestamp}.${rawBody.toString("utf8")}`;
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(veri);
    verifier.end();
    return verifier.verify(KICK_PUBLIC_KEY, Buffer.from(signature, "base64"));
  } catch (e) {
    console.error("[kick] Imza dogrulama hatasi:", e.message);
    return false;
  }
}
