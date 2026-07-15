// Yonetim paneli API uclari
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import * as kick from "./kickApi.js";
import * as store from "./store.js";
import * as ayar from "./config.js";
import * as mod from "./moderation.js";
import * as cmd from "./commands.js";
import * as games from "./games.js";
import * as chatlog from "./chatlog.js";
import * as shop from "./shop.js";
import * as stats from "./stats.js";

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
      oyun: games.oyunDurumu(),
      anket: games.anketDurumu(),
      sikiMod: mod.sikiModDurumu(),
      bekleyenTalep: shop.talepListesi("bekliyor").length,
      sayilar: {
        islem: db.ban_gecmisi.length,
        cezali: Object.keys(db.cezalar || {}).length,
        yasakli: (db.yasakli_ek || []).length,
        komut: Object.keys(c.komutlar || {}).filter((a) => !a.startsWith("_")).length,
      },
    });
  });

  // ---------------- Canli sohbet ----------------
  r.get("/api/sohbet", kilit, (req, res) => {
    const sonNo = Number(req.query.sonNo || 0);
    res.json(sonNo > 0 ? chatlog.getir(sonNo) : chatlog.hepsi());
  });

  // Panelden tek mesaj silme
  r.post("/api/sohbet/sil", kilit, async (req, res) => {
    const id = String(req.body?.id || "");
    if (!id) return res.status(400).json({ hata: "Mesaj kimliği gerekli." });
    try {
      await kick.mesajSil(id);
      chatlog.silindiIsaretle(id, "Panelden silindi");
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ hata: e.message });
    }
  });

  // ---------------- Oyunlar ----------------
  r.get("/api/oyun", kilit, (_req, res) => {
    res.json({ oyun: games.oyunDurumu(), anket: games.anketDurumu(), tipler: games.OYUN_TIPLERI });
  });

  r.post("/api/oyun", kilit, async (req, res) => {
    const islem = String(req.body?.islem || "basla");
    const c = ayar.get();

    if (islem === "bitir") {
      const m = games.oyunBitir();
      if (m) await ctx.duyur(m).catch(() => {});
      return res.json({ ok: true });
    }

    const r2 = games.oyunBaslat(String(req.body?.tip || "rastgele"), c);
    if (!r2.ok) return res.status(400).json({ hata: r2.hata });
    try {
      await ctx.duyur(r2.duyuru);
    } catch (e) {
      games.oyunBitir(); // duyuru gitmediyse oyunu yarim birakma
      return res.status(500).json({ hata: "Sohbete yazılamadı, oyun iptal edildi: " + e.message });
    }
    res.json({ ok: true, tip: r2.tip });
  });

  // ---------------- Anket ----------------
  r.post("/api/anket", kilit, async (req, res) => {
    const islem = String(req.body?.islem || "basla");
    const c = ayar.get();

    if (islem === "bitir") {
      const m = games.anketBitir();
      if (m) await ctx.duyur(m).catch(() => {});
      return res.json({ ok: true });
    }

    const r2 = games.anketBaslat(req.body?.soru, req.body?.secenekler, c);
    if (!r2.ok) return res.status(400).json({ hata: r2.hata });
    try {
      await ctx.duyur(r2.duyuru);
    } catch (e) {
      games.anketBitir(); // duyuru gitmediyse anketi yarim birakma
      return res.status(500).json({ hata: "Sohbete yazılamadı, anket iptal edildi: " + e.message });
    }
    res.json({ ok: true });
  });

  // ---------------- Siki mod (panik butonu) ----------------
  r.get("/api/sikimod", kilit, (_req, res) => res.json(mod.sikiModDurumu()));

  r.post("/api/sikimod", kilit, async (req, res) => {
    const aktif = Boolean(req.body?.aktif);
    const dakika = Number(req.body?.dakika || 0);
    const d = mod.sikiModAyarla(aktif, dakika, false);
    store.logEkle({
      kullanici: "-",
      sebep: aktif ? `Sıkı mod açıldı${dakika ? ` (${dakika} dk)` : ""}` : "Sıkı mod kapatıldı",
      islem: "sikimod",
      yetkili: "panel",
    });
    try {
      await ctx.duyur(
        aktif
          ? "🛡️ SIKI MOD açıldı — link yasak, spam eşikleri sertleştirildi."
          : "✅ Sıkı mod kapatıldı, sohbet normale döndü.",
        2
      );
    } catch {}
    res.json(d);
  });

  // ---------------- Dukkan ----------------
  r.get("/api/dukkan", kilit, (_req, res) => {
    res.json({
      ayar: ayar.get().dukkan || { aktif: false, urunler: [] },
      talepler: shop.talepListesi(),
    });
  });

  r.post("/api/dukkan/talep", kilit, async (req, res) => {
    const { id, karar } = req.body || {};
    const r2 = shop.talepKarar(id, karar, (kul, m) => cmd.puanVer(kul, m));
    if (!r2.ok) return res.status(400).json({ hata: r2.hata });

    const t = r2.talep;
    try {
      if (karar === "onay") {
        // Duyuru urunuyse kullanicinin notunu sohbete dus
        if (t.tip === "duyuru" && t.not) {
          await ctx.duyur(`📢 @${t.kullanici}: ${t.not}`, 1);
        } else {
          await ctx.duyur(`✅ @${t.kullanici} → ${t.urunAd} onaylandı!${t.not ? " " + t.not : ""}`, 1);
        }
      } else {
        await ctx.duyur(`❌ @${t.kullanici} → ${t.urunAd} reddedildi. ${r2.iade} puan iade edildi.`, 1);
      }
    } catch {}

    res.json({ ok: true, talep: t, iade: r2.iade });
  });

  r.delete("/api/dukkan/talep", kilit, (_req, res) => {
    shop.talepTemizle();
    res.json({ ok: true });
  });

  // ---------------- Istatistik ----------------
  r.get("/api/istatistik", kilit, (_req, res) => {
    res.json({ ...stats.ozet(), kuyruk: ctx.kuyrukDurumu?.() || null, sikiMod: mod.sikiModDurumu() });
  });

  r.delete("/api/istatistik", kilit, (_req, res) => {
    stats.sifirla();
    res.json({ ok: true });
  });

  // ---------------- Kullanici profili ----------------
  r.get("/api/profil/:kullanici", kilit, (req, res) => {
    const p = stats.profil(req.params.kullanici);
    if (!p) return res.status(404).json({ hata: "Bu kullanıcı hiç mesaj yazmamış." });
    res.json(p);
  });

  r.get("/api/kullanici-ara", kilit, (req, res) => res.json(stats.ara(req.query.q)));

  // ---------------- Kanal degistirme ----------------
  r.post("/api/kanal", kilit, async (req, res) => {
    const slug = String(req.body?.slug || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?kick\.com\//, "") // tam link yapistirilirsa
      .replace(/\/$/, "");

    if (!slug) return res.status(400).json({ hata: "Kanal adı boş olamaz." });
    if (!kick.girisYapildiMi()) return res.status(400).json({ hata: "Bot giriş yapmamış. Önce /auth'tan giriş yap." });

    // 1) Kanal gercekten var mi?
    let bilgi;
    try {
      bilgi = await kick.kanalBilgisi(slug);
    } catch (e) {
      return res.status(500).json({ hata: "Kick'e ulaşılamadı: " + e.message });
    }
    if (!bilgi) return res.status(404).json({ hata: `"${slug}" adında bir kanal bulunamadı.` });

    // 2) Ayara yaz, onbellegi sifirla
    const c = ayar.get();
    c.kanal.slug = bilgi.slug || slug;
    ayar.kaydet(c);
    ctx.kanalSifirla?.();

    // 3) Webhook aboneligini yeni kanala tasi (bu olmadan mesajlar gelmez)
    let abonelik = "OK";
    try {
      await kick.abonelikleriYenile(bilgi.broadcaster_user_id);
    } catch (e) {
      abonelik = e.message;
    }

    res.json({
      ok: true,
      slug: c.kanal.slug,
      kanalId: bilgi.broadcaster_user_id,
      abonelik,
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
    ctx.kanalSifirla?.(); // kanal adi degismis olabilir
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

  // ---------------- Otomatik tepkiler ----------------
  r.get("/api/tepkiler", kilit, (_req, res) => res.json(ayar.get().otomatik_tepkiler || { aktif: false, kurallar: [] }));

  r.post("/api/tepkiler", kilit, (req, res) => {
    const tetik = String(req.body?.tetik || "").trim();
    const cevap = String(req.body?.cevap || "").trim();
    const tam = req.body?.tam_kelime !== false;
    if (!tetik || !cevap) return res.status(400).json({ hata: "Tetik ve cevap gerekli." });
    if (cevap.length > 480) return res.status(400).json({ hata: "Cevap çok uzun (en fazla 480)." });

    const c = ayar.get();
    if (!c.otomatik_tepkiler) c.otomatik_tepkiler = { aktif: true, bekleme_saniye: 30, kurallar: [] };
    // Ayni tetik varsa guncelle
    c.otomatik_tepkiler.kurallar = c.otomatik_tepkiler.kurallar.filter(
      (k) => k.tetik.toLocaleLowerCase("tr-TR") !== tetik.toLocaleLowerCase("tr-TR")
    );
    c.otomatik_tepkiler.kurallar.push({ tetik, cevap, tam_kelime: tam });
    ayar.kaydet(c);
    res.json({ ok: true, kurallar: c.otomatik_tepkiler.kurallar });
  });

  r.delete("/api/tepkiler", kilit, (req, res) => {
    const tetik = String(req.query.tetik || "");
    const c = ayar.get();
    if (c.otomatik_tepkiler) {
      c.otomatik_tepkiler.kurallar = c.otomatik_tepkiler.kurallar.filter((k) => k.tetik !== tetik);
      ayar.kaydet(c);
    }
    res.json({ ok: true });
  });

  r.post("/api/tepkiler/durum", kilit, (req, res) => {
    const c = ayar.get();
    if (!c.otomatik_tepkiler) c.otomatik_tepkiler = { aktif: true, bekleme_saniye: 30, kurallar: [] };
    c.otomatik_tepkiler.aktif = Boolean(req.body?.aktif);
    ayar.kaydet(c);
    res.json({ ok: true, aktif: c.otomatik_tepkiler.aktif });
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
      biletler: ck.biletler || {},
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
      ck.biletler = {};
      ck.kazanan = null;
      store.kaydet();
      await duyur(`🎉 ÇEKİLİŞ BAŞLADI! Katılmak için sohbete "${anahtar}" yaz.`);
      return res.json({ ok: true });
    }

    if (islem === "cek") {
      const r3 = cmd.cekilisCek(); // bilet alanlarin sansi daha yuksek
      if (!r3) return res.status(400).json({ hata: "Katılımcı yok." });
      const ek = r3.bilet > r3.katilimci ? ` [${r3.bilet} bilet]` : "";
      await duyur(`🏆 KAZANAN: @${r3.kazanan}! (${r3.katilimci} katılımcı${ek} arasından) Tebrikler!`);
      return res.json({ ok: true, ...r3 });
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
