# NEUROCLI - TAM EKSİKLİK LİSTESİ
# Claude Code, Gemini CLI, OpenCode/Crush, Kilo Code ile Kıyasla
# Temmuz 2026

================================================================================
P0 - KRİTİK EKSİKLİKLER (Rekabet edebilirlik için zorunlu)
================================================================================

1. MCP PROTOKOL DESTEĞİ
   - MCP istemcisi yok (stdio/HTTP/SSE transport)
   - .neuro/mcp.json yapılandırma dosyası yok
   - /mcp slash komutu yok
   - MCP araç keşfi ve yürütme mekanizması yok
   - MCP OAuth desteği yok
   - MCP araç zaman aşımı yapılandırması yok
   Rakip durumu: Claude Code (3000+ entegrasyon), Gemini (Full), OpenCode (Full+OAuth), Kilo (Full+Marketplace)

2. GERÇEK ONAY İSTEMİ (APPROVAL PROMPT)
   - handleApproval() fonksiyonu otomatik onaylıyor, kullanıcıya soru sormuyor
   - Risk seviyesi gösterimi var ama interaktif onay/red mekanizması yok
   - Kullanıcı tehlikeli işlemleri durduramıyor
   - onay modları arasında geçiş yapılamıyor (Shift+Tab gibi)
   Rakip durumu: Tüm rakiplerde interaktif onay mekanizması var

3. OTURUM DEVAM ETTİRME CLI KOMUTU
   - SessionManager.load() kodu var ama CLI'dan erişilemiyor
   - /resume komutu yok
   - neuro --continue flag yok
   - neuro --resume <id> komutu yok
   - Oturum seçici/tarayıcı UI yok
   Rakip durumu: Claude (-c/-r), Gemini (--resume), OpenCode (Ctrl+A), Kilo (--continue)

4. OTOMATİK TAMAMLAMA (TAB COMPLETION)
   - Slash komutları için tamamlama yok
   - Dosya yolları için tamamlama yok
   - Model isimleri için tamamlama yok
   - Ajan isimleri için tamamlama yok
   -readline completer fonksiyonu tanımlı değil
   Rakip durumu: Claude (slash+shell+model), Gemini (slash+@), OpenCode (slash+@), Kilo (FIM+slash)

================================================================================
P1 - YÜKSEK ÖNCELİKLİ EKSİKLİKLER (Kullanıcı deneyimini büyük etkiler)
================================================================================

5. VS CODE EKLENTİSİ
   - VS Code extension yok
   - Diff görüntüleyici entegrasyonu yok
   - Dosya referansı paylaşımı yok
   - Hızlı erişim tuşları yok (Cmd+Esc vb.)
   - Context (aktif dosya/seçim) paylaşımı yok
   Rakip durumu: Tüm rakiplerde VS Code eklentisi var (Kilo: 1M+ install)

6. DIFF ÖNİZLEME UI
   - Dosya değişiklikleri önceden gösterilmiyor
   - apply_diff ve edit_file doğrudan uyguluyor, kullanıcı onayı yok
   - Inline diff görüntüleme yok
   - Renk kodlu ekleme/silme gösterimi yok
   - Değişiklik istatistikleri yok (+247 -89 gibi)
   Rakip durumu: Claude (inline+IDE), Gemini (IDE diff), OpenCode (TUI diff wrap)

7. SANDBOX/YALITIM SİSTEMİ
   - İşletim sistemi seviyesinde proses yalıtımı yok
   - macOS Seatbelt desteği yok
   - Linux Bubblewrap desteği yok
   - Dosya sistemi yazma kısıtlaması yok
   - Ağ erişim kontrolü yok
   - sandbox-exec / bwrap entegrasyonu yok
   Rakip durumu: Claude (Seatbelt+Bubblewrap), Gemini (5 yöntem), Kilo (Bwrap+seccomp+netns)

8. ÖZEL ARAÇLAR SDK
   - Dış geliştiriciler için araç yazma SDK'sı yok
   - Plugin dokümantasyonu yok
   - Zod şema doğrulama yok
   - Araç geçersiz kılma mekanizması yok (custom tool override)
   - @opencode-ai/plugin benzeri paket yok
   Rakip durumu: Claude (Plugin SDK), OpenCode (plugin SDK+Zod), Kilo (custom tools)

9. HEADLESS/CI MODU
   - Çok adımlı otonom çalışma modu yok
   - --max-turns flag yok
   - --allowedTools flag yok
   - JSON çıktı formatı yok (--output-format json)
   - CI/CD boru hattı entegrasyonu yok
   - Çıkış kodları tanımlı değil (0=başarı, 1=hata)
   Rakip durumu: Claude (--max-turns), Gemini (headless), OpenCode (-p -f json), Kilo (--auto)

10. ONAY MODLARI ÇOĞULLUĞU
    - Sadece 2 mod var (auto/manual)
    - Manuel mod (her şey sorulur) yok
    - Auto mod (güvenli sınıflandırıcı) yok
    - Plan modu (salt okunur) yok
    - Modlar arası hızlı geçiş yok (Shift+Tab)
    Rakip durumu: Claude (3 mod), Gemini (4 mod), OpenCode (3 kademe), Kilo (granular per-tool)

================================================================================
P2 - ORTA ÖNCELİKLİ EKSİKLİKLER (Ürün olgunluğunu artırır)
================================================================================

11. ÖZEL AJAN TANIMLAMA (DOSYA TABANLI)
    - Markdown/JSON dosyalarla ajan tanımlama yok
    - YAML frontmatter desteği yok
    - .neuro/agents/ dizini yok
    - Ajan dosya keşfi yok
    - Dosyadan otomatik ajan yükleme yok
    Rakip durumu: Claude (YAML frontmatter), Gemini (agent def files), OpenCode (.opencode/agents/)

12. OTURUM FORK
    - --fork flag yok
    - /fork komutu yok
    - Oturumu dallandırma yok
    - Alternatif yol deneme imkanı yok
    Rakip durumu: Claude (--fork-session), Gemini (/resume save), OpenCode (fork), Kilo (--fork)

13. BECERİ (SKILL) SİSTEMİ
    - .neuro/skills/ dizini yok
    - skill.md dosya formatı yok
    - Görev bağlamına göre otomatik beceri aktivasyonu yok
    - Beceri keşif mekanizması yok
    - /skills komutu yok
    Rakip durumu: Claude (auto-activate skills), Gemini (Agent Skills), OpenCode/Kilo (skills/)

14. HARCAMA LİMİTİ
    - Günlük harcama limiti yok
    - Kullanıcı bazlı limit yok
    - Bakiye uyarı sistemi yok
    - Sıfır bakiyede durdurma yok
    Rakip durumu: Claude (org limits), Gemini (günlük limit), Kilo (per-user daily)

15. PROMPT ÖNBELLEK (CACHE)
    - Prompt caching mekanizması yok
    - Önbellek isabet oranı gösterimi yok
    - Tekrarlanan promptlarda tasarruf yok
    - /cost içinde önbellek breakdown yok
    Rakip durumu: Claude (prompt caching), Gemini (token caching)

16. ÖZEL ARAÇLAR DİZİNİ
    - .neuro/tools/ dizini yok
    - Global araç dizini (~/.neuro/tools/) yok
    - Araç dosyalarından otomatik yükleme yok
    Rakip durumu: OpenCode (.opencode/tools/), Kilo (custom tools)

17. UZANTI/PAZARYERİ
    - Eklenti sistemi yok
    - Pazaryeri yok
    - /plugin komutu yok
    - Eklenti keşif/yükleme/güncelleme yok
    Rakip durumu: Claude (28+ plugin), Gemini (extension registry), Kilo (Kilo Marketplace)

18. /undo ve /redo KOMUTLARI
    - /undo komutu CLI'da yok
    - /redo komutu yok
    - Esc×2 ile geri alma yok
    - Geri alma geçmişi yok
    Rakip durumu: Claude (/rewind Esc×2), Gemini (/rewind), OpenCode (/undo+/redo), Kilo (/undo+/redo)

19. OTURUM TARAYICISI
    - Oturum listeleme UI yok
    - Arama/filtreleme yok
    - Klavye navigasyonu yok
    - Oturum önizleme yok
    Rakip durumu: Claude (/resume picker), Gemini (Session Browser), Kilo (/sessions)

20. OTURUM DIŞA AKTARMA/İÇE AKTARMA
    - /export komutu yok
    - /import komutu yok
    - JSON çıktı olarak oturum kaydetme yok
    Rakip durumu: Claude (/export), OpenCode (/share+export), Kilo (kilo export/import)

21. MODEL YÖNLENDİRME (ROUTING)
    - Otomatik model yönlendirme yok
    - Basit görev→hızlı model, karmaşık→güçlü model yok
    - Yerel sınıflandırıcı yok (Gemma 1B gibi)
    - Effort level (low/medium/high) yok
    Rakip durumu: Claude (effort levels), Gemini (Auto mode+Gemma router), Kilo (auto model)

22. GÖREV SIRASINDA MODEL DEĞİŞTİRME
    - /model komutu sadece başlangıçta çalışıyor
    - Oturum içinde model değiştirme yok
    - Model seçici UI yok
    Rakip durumu: Claude (/model), Gemini (/model), OpenCode (Ctrl+T), Kilo (/models)

23. NEURO.IGNORE DOSYASI
    - AI'ın erişemeyeceği dosyaları belirtme yok
    - .neuroignore dosya formatı yok
    - Otomatik hariç tutma (node_modules vb.) yok
    Rakip durumu: Gemini (.geminiignore), Kilo (.kilocodeignore)

================================================================================
P3 - DÜŞÜK ÖNCELİKLİ EKSİKLİKLER (Piyasa kapsamını genişletir)
================================================================================

24. TARAYICI AJANI
    - Web tarayıcısı otomasyonu yok
    - Navigate, form doldurma, veri çekme yok
    - Chrome DevTools MCP entegrasyonu yok
    - Erişilebilirlik ağacı ile etkileşim yok
    Rakip durumu: Claude (Chrome ent.), Gemini (Browser Agent)

25. SESLİ GİRİŞ/ÇIKTI
    - Ses ile komut verme yok
    - Push-to-talk yok
    - Metinden sese dönüşüm yok
    - /voice komutu yok
    Rakip durumu: Claude (voice mode), Kilo (voice transcription)

26. JETBRAINS EKLENTİSİ
    - IntelliJ/PyCharm/WebStorm eklentisi yok
    - ACP (Agent Client Protocol) desteği yok
    Rakip durumu: Claude (dedicated plugin), Gemini (ACP), Kilo (Kotlin plugin)

27. YEREL MODEL (OLLAMA) DESTEĞİ
    - Ollama entegrasyonu yok
    - LM Studio desteği yok
    - LOCAL_ENDPOINT yapılandırması yok
    - Açık OpenAI-uyumlu uç nokta yok
    Rakip durumu: OpenCode (Ollama+LM Studio), Kilo (Ollama+LM Studio)

28. OTURUM PAYLAŞMA
    - /share komutu yok
    - Paylaşılabilir URL oluşturma yok
    - Bulut aktarma yok
    Rakip durumu: Claude (/export), OpenCode (/share), Kilo (/share+URL)

29. MASAÜSTÜ UYGULAMASI
    - Native masaüstü uygulaması yok
    - Electron/Tauri wrapper yok
    Rakip durumu: Claude (Desktop app), OpenCode (Desktop+Web), Kilo (Cloud Agent)

30. A2A PROTOKOLÜ
    - Agent-to-Agent protokol desteği yok
    - Uzaktan ajan delege etme yok
    - Dağıtılmış ajan orkestrasyonu yok
    Rakip durumu: Gemini (A2A protocol)

31. ARKA PLAN AJANLARI
    - Arka planda çalışan asenkron ajanlar yok
    - /agents veya /tasks dashboard yok
    - Tamamlanan ajan bildirimi yok
    Rakip durumu: Claude (background agents)

32. ÇOKLU SAĞLAYICI DESTEĞİ
    - Sadece OpenRouter destekleniyor
    - Doğrudan Anthropic API desteği yok
    - Doğrudan OpenAI API desteği yok
    - Amazon Bedrock desteği yok
    - Google Vertex AI desteği yok
    - Azure OpenAI desteği yok
    Rakip durumu: OpenCode (75+ provider), Kilo (500+ via Gateway)

33. GIT WORKTREE DESTEĞİ
    - Her oturum için ayrı worktree yok
    - Oturumlar arası çakışma önleme yok
    Rakip durumu: Gemini (git worktrees per session)

34. FALLBACK MODEL ZİNCİRİ
    - Model başarısız olduğunda yedek modele geçme yok
    - fallbackModel yapılandırması yok
    - Sıkıştırma sırasında fallback yok
    Rakip durumu: Claude (fallback model chains)

35. PR BAĞLANTILI OTURUMLAR
    - GitHub PR ile oturum bağlantısı yok
    - --from-pr komutu yok
    - PR oluşturma sırasında otomatik bağlantı yok
    Rakip durumu: Claude (--from-pr), Kilo (kilo pr)

36. ÇAPRAZ PLATFORMLU SANDBOX
    - Windows sandbox desteği yok
    - gVisor/runsc desteği yok
    - Docker/Podman izolasyonu yok
    Rakip durumu: Gemini (5 yöntem: Seatbelt, Docker, Windows, gVisor, LXC)

37. DOOM LOOP KORUMASI
    - Tekrar eden başarısızlık döngüsü algılama yok
    - Sıkışmış ajan duraklatma yok
    - doom_loop izin kuralı yok
    Rakip durumu: Kilo (varsayılan doom loop koruması)

38. UZANTI HOOK'LARI
    - tool.execute.before/after hook yok
    - PreToolUse/PostToolUse lifecycle yok
    - Hook çıktısında terminalSequence yok
    Rakip durumu: Claude (PreToolUse/PostToolUse), OpenCode (before/after)

39. DİĞER EKSİK SLASH KOMUTLARI
    - /commit-push-pr yok (commit+push+PR tek komut)
    - /code-review yok (çoklu ajan kod incelemesi)
    - /doctor yok (kurulum kontrolü)
    - /release-notes yok
    - /feedback yok
    - /rewind yok
    Rakip durumu: Claude (20+ slash komut), Gemini (15+), OpenCode (14+)

40. ÇIKTI STİLLERİ
    - Explanatory, Learning, Concise gibi çıktı stilleri yok
    - .neuro/styles/ dizini yok
    - /style komutu yok
    Rakip durumu: Claude (12 yerleşik stil)

41. GENİŞLETİLMİŞ DÜŞÜNME (EXTENDED THINKING)
    - Düşünme bloklarını gösterme/gizleme yok
    - /thinking komutu yok
    - Düşünme token bütçesi yapılandırması yok
    - Ultrathink modu yok
    Rakip durumu: Claude (extended thinking+effort), Kilo (/thinking toggle)

42. UZAKTAN KONTROL
    - Mobil/web istemcisinden kontrol yok
    - /remote-control komutu yok
    - WebSocket/tablosal bağlantı yok
    Rakip durumu: Claude (remote control)

43. ÇOKLUALTI ORTAM DESTEĞİ
    - Docker image yok
    - ghcr.io/neuro-cli:latest yok
    - Konteyner içinde çalıştırma desteği yok
    Rakip durumu: Gemini (Docker image)

44. KURULUM DOĞRULAMA
    - /doctor komutu yok
    - Otomatik kurulum kontrolü yok
    - Eksik bağımlılık uyarısı yok
    Rakip durumu: Claude (/doctor)

45. SHELL COMPLETION SCRIPT'LARI
    - bash/zsh/fish completion scriptleri yok
    - kilo completion benzeri komut yok
    Rakip durumu: Kilo (kilo completion)

================================================================================
ÖZET İSTATİSTİKLER
================================================================================

Toplam eksik özellik sayısı: 45
P0 (Kritik):        4 özellik
P1 (Yüksek):        6 özellik
P2 (Orta):         13 özellik
P3 (Düşük):        22 özellik

Tahmini uygulama süresi:
- P0 tamamlama: 1-2 hafta
- P0+P1 tamamlama: 3-6 hafta
- P0+P1+P2 tamamlama: 2-3 ay
- Tümü tamamlama: 4-6 ay

P0+P1 tamamlandığında NeuroCLI skor tahmini: 61/100 → 80+/100
