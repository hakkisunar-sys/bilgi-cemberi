# Bilgi Çemberi

Telefondan oynanan çok oyunculu bilgi yarışması. Herkes kendi telefonundan aynı tahtayı görür; zar atar, piyonunu ilerletir, soruları cevaplar.

## GitHub Pages'te yayınlama (bir kez yapılır)

1. github.com'da yeni bir repo aç (örneğin `bilgi-cemberi`), **Public** olsun.
2. "uploading an existing file" linkine tıkla, bu klasördeki **tüm dosyaları** (`lib` klasörü dahil) sürükleyip bırak, **Commit changes**.
3. Repo'da **Settings → Pages** → Source: **Deploy from a branch**, Branch: **main**, klasör **/(root)** → **Save**.
4. 1-2 dakika sonra oyun şu adreste açılır: `https://KULLANICI-ADIN.github.io/bilgi-cemberi/`

## Nasıl oynanır

- Bir kişi **Yeni oyun kur**'a basar; ekranda 4 harfli oda kodu ve QR çıkar. Diğerleri kodu girer, QR'ı okutur ya da davet linkine tıklar.
- Oda 3–10 oyuncuyla başlar. Denemek için kurucu lobide **Bot ekle** ile bot ekleyebilir (Kolay / Orta / Zor). Botlar da oyuncu sayısına dahildir.
- Kurucu bireysel/takım oyunu ve soru süresini seçer (varsayılan 60 sn).
- Kurucu ⋯ menüsünden oyunu **duraklatabilir** (süre de durur), **sırayı geçebilir**, **bitirebilir**.

### Kurallar
- İlk oyuncu rastgele seçilir, sonra sıra sabit döngüyle ilerler. Herkes ortadan başlar.
- Sırası gelen telefonu sallayarak ya da **Zar at** düğmesiyle zar atar. Tam o kadar adımla gidilebilecek kareler parlar, biri seçilir (aynı atışta geri dönülmez).
- Soru, durulan karenin renginden gelir. Ortadaki kareye gelen kategoriyi kendisi seçer.
- Herkes soruyu ve şıkları görür, sadece sıra sahibi cevaplar. Şık seçilir, istenirse değiştirilir; **Kilitle**'ye basınca cevap kesinleşir.
- Doğru cevap eksikse o rengi kazandırır; iki durumda da aynı oyuncu yeniden zar atar. Yanlış ya da süre dolması sırayı bitirir.
- Altıncı rengi alan, aynı turda zar atmadan rastgele kategoriden **final sorusu** alır. Bilen maçı kazanır; bilemeyen renklerini korur, sırası gelince yeni final sorusu alır.
- İlk kazanandan sonra kurucu maçı bitirebilir ya da sıralama için devam ettirebilir.
- Takım oyununda zarı takımdan biri atar; gidilecek kare ve cevap için takımdaki herkesin aynı şeyi kilitlemesi gerekir. Bağlantısı kopan üye beklenmez.
- Bir maçta hiçbir soru iki kez gelmez. Zorluk dağılımı %20 Normal, %40 Zor, %40 Çok Zor. Sorusu biten renk tahtada soluk ve ✕ ile gösterilir.

## Sorular

`questions.js` dosyasında: 6 kategori, toplam 1.500 soru. Her sorunun kimliği (ör. COG-001) soru kartının köşesinde görünür, hatalı soru bildirmek için kullanılabilir.

## Teknik not

Telefonlar herkese açık ücretsiz MQTT sunucuları üzerinden haberleşir (hesap gerekmez). Oyunun durumu kurucunun telefonunda tutulur; kurucu sayfayı kapatırsa oyun durur, aynı linki tekrar açınca kaldığı yerden devam eder. Herkesin internete bağlı olması yeterli.
