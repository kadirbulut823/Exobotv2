// Guncelleme notlari
// Yeni bir guncelleme yapildiginda bu listenin BASINA yeni kayit eklenir.
// Panel "Guncellemeler" sekmesinde gosterilir.

export const SURUM = "2.6.0";

export const NOTLAR = [
  {
    surum: "2.6.0",
    tarih: "2026-07-31",
    baslik: "Profiller, etiketli tepkiler ve otomatik temizlik",
    maddeler: [
      "Kanal profilleri: bir kanala bağlanınca tüm ayarlar/puanlar/komutlar o kanala özel kaydediliyor. Kanal değiştirip geri dönünce her şey yerinde.",
      "Aktif profil her 5 dakikada bir otomatik yedekleniyor.",
      "Otomatik tepkilerde {kullanici} etiketi: 'sa' yazana 'as @kullanıcı' gibi cevap verilebiliyor.",
      "Ceza kayıtları 7 günden eskiyse otomatik siliniyor.",
      "Güncellemeler sekmesi eklendi (şu an baktığın yer).",
    ],
  },
  {
    surum: "2.5.0",
    tarih: "2026-07-30",
    baslik: "WebSocket sohbet + kalıcı sorun tespiti",
    maddeler: [
      "Sohbet artık Kick'in WebSocket'inden okunuyor — webhook abonelik sorunları (yanlış kanala abone olma) kökten çözüldü.",
      "Sorun tespiti (tanı) ekranı: bot çalışmadığında nerede takıldığını adım adım gösteriyor.",
      "Yayın durumu artık doğrudan Kick'e sorularak alınıyor (60 sn'de bir).",
      "Chatroom ID panelden elle girilebiliyor (Cloudflare çözmeyi engellerse).",
    ],
  },
  {
    surum: "2.4.0",
    tarih: "2026-07-16",
    baslik: "Link kuyruğu ve otomatik tepkiler",
    maddeler: [
      "Link kuyruğu: sohbette paylaşılan linkler panelde toplanıyor, 'Gördüm' deyince bot teşekkür yazıyor, aynı link tekrar atılırsa uyarıyor.",
      "Otomatik tepkiler: '!' gerekmeyen anahtar kelime cevapları (sa → as).",
    ],
  },
  {
    surum: "2.3.0",
    tarih: "2026-07-15",
    baslik: "Dükkân, sıkı mod, istatistikler",
    maddeler: [
      "Puan dükkânı: !dukkan / !al ile şarkı isteği, çekiliş bileti, duyuru satın alma; mod onay kuyruğu.",
      "Sıkı mod (panik butonu) + otomatik raid tespiti.",
      "İstatistik sekmesi: filtre tetiklenme sayıları, saatlik yoğunluk, kullanıcı profilleri.",
      "Mesaj kuyruğu: bot Kick mesaj limitine takılmıyor, moderasyon uyarıları öncelikli.",
      "Komut bekleme süresi (spam koruması) ve oyun sırasında flood muafiyeti.",
    ],
  },
  {
    surum: "2.2.0",
    tarih: "2026-07-15",
    baslik: "Oyunlar ve canlı sohbet",
    maddeler: [
      "5 sohbet oyunu: karışık kelime (anlam destekli), quiz, sayı tahmini, hızlı yazma, matematik.",
      "Anket sistemi (sohbete 1/2/3 yazarak oylama).",
      "Canlı sohbet paneli: mesaja tıklayıp sil/sustur/banla.",
      "Kelime havuzuna anlam ekleme: kelime|anlamı — bilince bot anlamını da yazıyor.",
    ],
  },
  {
    surum: "2.0.0",
    tarih: "2026-07-14",
    baslik: "Yönetim paneli",
    maddeler: [
      "Web paneli: komutlar, yasaklı kelimeler, ceza puanları, moderasyon kaydı, filtre ayarları, puan tablosu.",
      "Ayarlar kalıcı diske taşındı — deploy'da kaybolmuyor.",
      "Kanal panelden değiştirilebiliyor.",
    ],
  },
  {
    surum: "1.0.0",
    tarih: "2026-07-13",
    baslik: "İlk sürüm",
    maddeler: [
      "Küfür/link/spam filtreleri, kademeli ceza sistemi (uyarı → susturma → ban).",
      "Mod komutları: !to !ban !unban !af !duyuru !yasakekle.",
      "Çekiliş, puan sistemi, otomatik duyurular, takipçi karşılama.",
    ],
  },
];
