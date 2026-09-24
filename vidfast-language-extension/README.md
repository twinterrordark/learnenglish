# LearnEnglish — VidFast altyazı köprüsü

Bu küçük Chrome eklentisi, VidFast iframe'indeki **İngilizce** altyazı satırlarını üstteki LearnEnglish sayfasına iletir. Video veya altyazı dosyası indirmez; Tauruss API'sine bağlanmaz. Türkçe çeviri sayfadaki yerel modelle yapılır; ilk kullanımda model dosyaları tarayıcı önbelleğine alınır.

## Kurulum

1. Chrome'da `chrome://extensions` sayfasını aç.
2. Sağ üstten **Geliştirici modu**'nu etkinleştir.
3. **Paketlenmemiş öğe yükle**'yi seçip bu klasörü göster: `vidfast-language-extension`.
4. LearnEnglish'i Chrome'da `http://127.0.0.1:8765/` adresinden aç. Codex'in yerleşik tarayıcısı Chrome eklentilerini çalıştırmaz.
5. Uygulamada **Film + Çift Altyazı**'nı aç, film sayfasına gir ve Tauruss player'ında VidFast'i seç. Player ayarlarından **English subtitles**'ı etkinleştir.

Sağ panel altyazı satırlarını ve yerel Türkçe çeviriyi gösterir. İlk çeviri sırasında modelin indirilmesi bir süre alabilir; altyazı metinleri bir çeviri servisine gönderilmez.
