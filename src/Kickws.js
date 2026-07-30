// Kick sohbetini Pusher WebSocket uzerinden dinler (gayri resmi yol).
//
// NEDEN VAR: Kick'in resmi webhook sistemi, kullanici token'iyla yalnizca
// token sahibinin KENDI kanalina abone olmaya izin veriyor. Bot hesabi
// baska bir kanali (ornegin yayincinin kanalini) resmi yoldan dinleyemiyor.
// Bu modul, Kick sitesinin kendi kullandigi herkese acik WebSocket'e
// baglanip sohbeti oradan okur.
//
// RISK: Bu resmi API degil. Kick WebSocket adresini/app key'ini degistirirse
// calismaz. O durumda asagidaki APP_KEY guncellenmeli (kick.com'da F12 ->
// Network -> "pusher" filtrele -> yeni adresi kopyala).
//
// Moderasyon islemleri (silme/ban/yazma) RESMI API'den gitmeye devam eder.

import WebSocket from "ws";

const APP_KEY = "32cbd69e4b950bf97679"; // kick.com'un kullandigi Pusher app key
const WS_URL = `wss://ws-us2.pusher.com/app/${APP_KEY}?protocol=7&client=js&version=8.4.0-rc2&flash=false`;

let ws = null;
let aktifChatroomId = null;
let sonMesajZamani = null;
let durumMetni = "başlatılmadı";
let yenidenBaglanmaSayisi = 0;
let kapatildi = false;

// Dinleyiciler: server.js buraya isleyici baglar
let mesajIsleyici = null;

export function durum() {
  return {
    bagli: ws?.readyState === 1,
    chatroomId: aktifChatroomId,
    durum: durumMetni,
    sonMesaj: sonMesajZamani,
    yenidenBaglanma: yenidenBaglanmaSayisi,
  };
}

export function sonMesajZamaniGetir() {
  return sonMesajZamani;
}

// Kick'in v2 API'sinden chatroom ID cozmeyi dener.
// Cloudflare engellerse null doner - o zaman panelden elle girilir.
export async function chatroomIdCoz(slug) {
  try {
    const r = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.chatroom?.id || null;
  } catch {
    return null;
  }
}

// Pusher mesajini botun bekledigi webhook formatina cevirir.
// Boylece server.js'deki sohbetMesaji() hic degismeden calisir.
function webhookFormatinaCevir(veri) {
  const sender = veri.sender || {};
  return {
    message_id: veri.id,
    content: veri.content || "",
    sender: {
      user_id: sender.id,
      username: sender.username,
      channel_slug: sender.slug,
      identity: {
        username_color: sender.identity?.color || null,
        badges: (sender.identity?.badges || []).map((b) => ({ type: b.type, text: b.text })),
      },
    },
    broadcaster: null, // WebSocket'te yok; server.js kanal bilgisini kendisi biliyor
  };
}

export function baglan(chatroomId, isleyici) {
  kapatildi = false;
  aktifChatroomId = chatroomId;
  mesajIsleyici = isleyici;
  ac();
}

function ac() {
  if (kapatildi || !aktifChatroomId) return;

  try {
    ws?.terminate?.();
  } catch {}

  durumMetni = "bağlanıyor";
  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    durumMetni = "bağlı";
    yenidenBaglanmaSayisi = 0;
    console.log(`[ws] Kick sohbetine baglandi (chatroom ${aktifChatroomId}).`);
    // Chatroom kanalina abone ol
    ws.send(
      JSON.stringify({
        event: "pusher:subscribe",
        data: { auth: "", channel: `chatrooms.${aktifChatroomId}.v2` },
      })
    );
    // v2 calismazsa diye eski kanala da abone ol (zararsiz, ayni mesaj iki kez gelirse id ile ayiklanir)
    ws.send(
      JSON.stringify({
        event: "pusher:subscribe",
        data: { auth: "", channel: `chatrooms.${aktifChatroomId}` },
      })
    );
  });

  const gorulenIdler = new Set();

  ws.on("message", (ham) => {
    let paket;
    try {
      paket = JSON.parse(ham.toString());
    } catch {
      return;
    }

    // Pusher ping'ine pong ile cevap ver (baglanti kopmasin)
    if (paket.event === "pusher:ping") {
      ws.send(JSON.stringify({ event: "pusher:pong", data: {} }));
      return;
    }

    if (paket.event !== "App\\Events\\ChatMessageEvent") return;

    let veri;
    try {
      veri = JSON.parse(paket.data);
    } catch {
      return;
    }

    // Iki kanala abone oldugumuz icin ayni mesaj iki kez gelebilir
    if (veri.id) {
      if (gorulenIdler.has(veri.id)) return;
      gorulenIdler.add(veri.id);
      if (gorulenIdler.size > 500) {
        const ilk = gorulenIdler.values().next().value;
        gorulenIdler.delete(ilk);
      }
    }

    sonMesajZamani = Date.now();
    if (mesajIsleyici) {
      mesajIsleyici(webhookFormatinaCevir(veri)).catch((e) =>
        console.error("[ws] Mesaj islenirken hata:", e.message)
      );
    }
  });

  ws.on("close", () => {
    if (kapatildi) return;
    durumMetni = "koptu, yeniden bağlanılıyor";
    yenidenBaglanmaSayisi++;
    // Ustel geri cekilme: 2s, 4s, 8s... en fazla 60s
    const bekle = Math.min(60000, 2000 * Math.pow(2, Math.min(yenidenBaglanmaSayisi, 5)));
    console.warn(`[ws] Baglanti koptu. ${Math.round(bekle / 1000)}s sonra tekrar denenecek.`);
    setTimeout(ac, bekle);
  });

  ws.on("error", (e) => {
    console.error("[ws] Hata:", e.message);
    // close olayi zaten tetiklenir, orada yeniden baglanilir
  });
}

export function kapat() {
  kapatildi = true;
  durumMetni = "kapatıldı";
  try {
    ws?.close();
  } catch {}
}
