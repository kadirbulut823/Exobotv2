// Yonetim paneli API uclari
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import * as kick from "./kickApi.js";
import * as store from "./store.js";
import * as ayar from "./config.js";
import * as mod from "./moderation.js";
import * as cmd from "./commands.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function panelRouter(ctx) {
  // ctx: { kanalHazirla, yayinDurumu }
  const r = express.Router();

  // --- Giris kontrolu ---
  const kilit = (req, res, next) => {
    const anahtar = process.env.PANEL_KEY;
    if (!anahtar) return res.status(500).json({ hata: "PANEL_KEY tanımlı değil. Railway → Variables'a ekle." });
    let gelen = req.get("x-panel-key") || req.query.key || "";
    // Tarayici Turkce karakterli sifreyi URL-kodlanmis gonderir, cozuyoruz
    try {
      gelen = decodeURIComponent(gelen);
    } catch {}
    if (gelen !== anahtar) return res.status(401).json({ hata: "Şifre yanlış." });
    next();
  };

  r.use(express.json({ limit: "1mb" }));

  // Panel sayfasi (sifre HTML icinde degil, tarayicida sorulur)
  r.get("/panel", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "panel.html"));
  });

  r.post("/api/giris", (req, res) => {
    const dogru = process.env.PANEL_KEY && req.body?.key === process.env.PANEL_KEY;
    res.json({ ok: Boolean(dogru) });
  });

  // ---------------- Durum ----------------
  r.get("/api/durum", kilit, async (_req, res) => {
    const db = store.get();
    const c = ayar.get();
    let kanal = null;
    try {
      kanal = await ctx.kanalHazirla();
    } catch {}
    const ck = cmd.cekilisDurum();
    res.json({
      giris: kick.girisYapildiMi(),
      kanal: kanal?.slug || c.kanal.slug,
      kanalId: kanal?.broadcaster_user_id || null,
      yayin: ctx.yayinDurumu(),
      cekilis: { aktif: ck.aktif, anahtar: ck.anahtar, katilimci: cmd.cekilisKatilimciSayisi(), kazanan: ck.kazanan },
      sayilar: {
        islem: db.ban_gecmisi.length,
        cezali: Object.keys(db.cezalar || {}).length,
        yasakli: (db.yasakli_ek || []).length,
        komut: Object.keys(c.komutlar || {}).filter((a) => !a.startsWith("_")).length,
      },
    });
  });

  // ---------------- Ayarlar ----------------
  r.get("/api/ayarlar", kilit, (_req, res) => res.json(ayar.get()));

  r.put("/api/ayarlar", kilit, (req, res) => {
    const yeni = req.body;
    if (!yeni || typeof yeni !== "object" || !yeni.kanal) {
      return res.status(400).json({ hata: "Ayarlar geçersiz." });
    }
    ayar.kaydet(yeni);
    res.json({ ok: true });
  });

  r.post("/api/ayarlar/sifirla", kilit, (_req, res) => res.json(ayar.sifirla()));

  // ---------------- Komutlar ----------------
  const komutlariTemizle = (k) =>
    Object.fromEntries(Object.entries(k || {}).filter(([ad]) => !ad.startsWith("_")));

  r.get("/api/komutlar", kilit, (_req, res) => res.json(komutlariTemizle(ayar.get().komutlar)));

  r.put("/api/komutlar", kilit, (req, res) => {
    const { ad, icerik } = req.body || {};
    const temiz = String(ad || "").trim().toLocaleLowerCase("tr-TR").replace(/^!/, "").replace(/\s+/g, "");
    if (!temiz) return res.status(400).json({ hata: "Komut adı boş olamaz." });
    if (!icerik?.trim()) return res.status(400).json({ hata: "Cevap boş olamaz." });
    if (icerik.length > 480) return res.status(400).json({ hata: "Cevap en fazla 480 karakter olabilir." });

    const c = ayar.get();
    c.komutlar = { ...(c.komutlar || {}), [temiz]: icerik.trim() };
    ayar.kaydet(c);
    res.json({ ok: true, komutlar: komutlariTemizle(c.komutlar) });
  });

  r.delete("/api/komutlar/:ad", kilit, (req, res) => {
    const c = ayar.get();
    delete c.komutlar[req.params.ad];
    ayar.kaydet(c);
    res.json({ ok: true, komutlar: c.komutlar });
  });

  // ---------------- Yasakli kelimeler ----------------
  r.get("/api/yasakli", kilit, (_req, res) => {
    const c = ayar.get();
    res.json({
      sohbetten: store.get().yasakli_ek || [],
      kufur: c.filtreler.kufur.kelimeler || [],
      sabit: c.filtreler.yasakli_kelimeler.kelimeler || [],
    });
  });

  r.post("/api/yasakli", kilit, (req, res) => {
    const kelime = String(req.body?.kelime || "").trim().toLocaleLowerCase("tr-TR");
    const liste = req.body?.liste || "sohbetten"; // sohbetten | kufur | sabit
    if (!kelime) return res.status(400).json({ hata: "Kelime boş olamaz." });

    if (liste === "sohbetten") {
      const db = store.get();
      if (!db.yasakli_ek.includes(kelime)) db.yasakli_ek.push(kelime);
      store.kaydet();
    } else {
      const c = ayar.get();
      const hedef = liste === "kufur" ? c.filtreler.kufur.kelimeler : c.filtreler.yasakli_kelimeler.kelimeler;
      if (!hedef.includes(kelime)) hedef.push(kelime);
      ayar.kaydet(c);
    }
    res.json({ ok: true });
  });

  r.delete("/api/yasakli", kilit, (req, res) => {
    const kelime = String(req.query.kelime || "");
    const liste = String(req.query.liste || "sohbetten");

    if (liste === "sohbetten") {
      const db = store.get();
      db.yasakli_ek = db.yasakli_ek.filter((k) => k !== kelime);
      store.kaydet();
    } else {
      const c = ayar.get();
      if (liste === "kufur") c.filtreler.kufur.kelimeler = c.filtreler.kufur.kelimeler.filter((k) => k !== kelime);
      else c.filtreler.yasakli_kelimeler.kelimeler = c.filtreler.yasakli_kelimeler.kelimeler.filter((k) => k !== kelime);
      ayar.kaydet(c);
    }
    res.json({ ok: true });
  });

  // ---------------- Moderasyon logu ----------------
  r.get("/api/log", kilit, (_req, res) => res.json(store.get().ban_gecmisi || []));

  r.delete("/api/log", kilit, (_req, res) => {
    store.get().ban_gecmisi = [];
    store.kaydet();
    res.json({ ok: true });
  });

  // ---------------- Ceza puanlari ----------------
  r.get("/api/cezalar", kilit, (_req, res) => {
    const c = ayar.get();
    const sifirlamaDk = c.cezalar?.puan_sifirlama_dakika ?? 60;
    const kayitlar = store.get().cezalar || {};
    const liste = Object.entries(kayitlar)
      .map(([kullanici, k]) => ({
        kullanici,
        puan: k.puan,
        sonIhlal: k.sonIhlal,
        gecerli: Date.now() - k.sonIhlal <= sifirlamaDk * 60000,
      }))
      .sort((a, b) => b.sonIhlal - a.sonIhlal);
    res.json(liste);
  });

  r.post("/api/af", kilit, async (req, res) => {
    const kullanici = String(req.body?.kullanici || "").toLowerCase();
    if (!kullanici) return res.status(400).json({ hata: "Kullanıcı adı gerekli." });

    mod.cezaPuaniSifirla(kullanici);
    let banKalkti = false;
    const id = cmd.kullaniciCache.get(kullanici);
    if (id) {
      try {
        const k = await ctx.kanalHazirla();
        await kick.banKaldir(k.broadcaster_user_id, id);
        banKalkti = true;
      } catch {}
    }
    store.logEkle({ kullanici, sebep: "Af (panel)", islem: "af", yetkili: "panel" });
    res.json({ ok: true, banKalkti });
  });

  // ---------------- Manuel moderasyon ----------------
  r.post("/api/ceza", kilit, async (req, res) => {
    const kullanici = String(req.body?.kullanici || "").toLowerCase().replace("@", "");
    const dakika = req.body?.dakika ? Number(req.body.dakika) : null; // yoksa kalici ban
    const sebep = String(req.body?.sebep || "Panel kararı");

    const id = cmd.kullaniciCache.get(kullanici);
    if (!id) {
      return res.status(404).json({
        hata: `"${kullanici}" bulunamadı. Kullanıcının bu yayında en az bir kez yazmış olması gerekiyor.`,
      });
    }
    try {
      const k = await ctx.kanalHazirla();
      await kick.banla(k.broadcaster_user_id, id, dakika, sebep);
      store.logEkle({ kullanici, sebep, islem: dakika ? "timeout" : "ban", sure: dakika, yetkili: "panel" });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ hata: e.message });
    }
  });

  // ---------------- Cekilis ----------------
  r.get("/api/cekilis", kilit, (_req, res) => {
    const ck = cmd.cekilisDurum();
    res.json({
      aktif: ck.aktif,
      anahtar: ck.anahtar,
      kazanan: ck.kazanan,
      katilimcilar: Object.keys(ck.katilimcilar || {}),
    });
  });

  r.post("/api/cekilis", kilit, async (req, res) => {
    const islem = String(req.body?.islem || "");
    const ck = cmd.cekilisDurum();
    const c = ayar.get();
    const k = await ctx.kanalHazirla().catch(() => null);

    const duyur = async (metin) => {
      if (!k || !c.bot.sohbete_yazsin) return;
      try {
        await kick.mesajGonder(k.broadcaster_user_id, metin, c.bot.mesaj_tipi);
      } catch (e) {
        console.error("[panel]", e.message);
      }
    };

    if (islem === "basla") {
      const anahtar = String(req.body?.anahtar || "!katil").trim().toLocaleLowerCase("tr-TR");
      ck.aktif = true;
      ck.anahtar = anahtar;
      ck.katilimcilar = {};
      ck.kazanan = null;
      store.kaydet();
      await duyur(`🎉 ÇEKİLİŞ BAŞLADI! Katılmak için sohbete "${anahtar}" yaz.`);
      return res.json({ ok: true });
    }

    if (islem === "cek") {
      const isimler = Object.keys(ck.katilimcilar || {});
      if (!isimler.length) return res.status(400).json({ hata: "Katılımcı yok." });
      const kazanan = isimler[Math.floor(Math.random() * isimler.length)];
      ck.kazanan = kazanan;
      ck.aktif = false;
      store.kaydet();
      await duyur(`🏆 KAZANAN: @${kazanan}! (${isimler.length} katılımcı arasından) Tebrikler!`);
      return res.json({ ok: true, kazanan, katilimci: isimler.length });
    }

    if (islem === "iptal") {
      ck.aktif = false;
      ck.katilimcilar = {};
      store.kaydet();
      await duyur("Çekiliş iptal edildi.");
      return res.json({ ok: true });
    }

    res.status(400).json({ hata: "Geçersiz işlem." });
  });

  // ---------------- Puanlar ----------------
  r.get("/api/puanlar", kilit, (_req, res) => {
    const liste = Object.entries(store.get().puanlar || {})
      .map(([kullanici, puan]) => ({ kullanici, puan }))
      .sort((a, b) => b.puan - a.puan);
    res.json(liste);
  });

  r.delete("/api/puanlar", kilit, (req, res) => {
    const db = store.get();
    const kullanici = req.query.kullanici;
    if (kullanici) delete db.puanlar[String(kullanici).toLowerCase()];
    else db.puanlar = {};
    store.kaydet();
    res.json({ ok: true });
  });

  // ---------------- Sohbete mesaj ----------------
  r.post("/api/mesaj", kilit, async (req, res) => {
    const metin = String(req.body?.metin || "").trim();
    if (!metin) return res.status(400).json({ hata: "Mesaj boş." });
    try {
      const k = await ctx.kanalHazirla();
      await kick.mesajGonder(k.broadcaster_user_id, metin, ayar.get().bot.mesaj_tipi);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ hata: e.message });
    }
  });

  return r;
}
