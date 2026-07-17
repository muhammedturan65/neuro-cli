#!/usr/bin/env python3
"""NeuroCLI Competitive Analysis PDF Report"""

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm, cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                 PageBreak, KeepTogether, HRFlowable)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

FONT_DIR = '/usr/share/fonts'

# Register fonts
pdfmetrics.registerFont(TTFont('NotoSerifSC', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Bold', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSC-Bold')

# NotoSansSC is a variable font - use SarasaMonoSC for sans or NotoSerifSC for everything
# Use NotoSerifSC for all text as it's guaranteed available
NotoSerifSC = 'NotoSerifSC'
NotoSerifSCBold = 'NotoSerifSC-Bold'

# Color palette
C_BG = colors.HexColor('#0d0c0b')
C_SECTION_BG = colors.HexColor('#151513')
C_CARD = colors.HexColor('#211f1c')
C_HEADER = colors.HexColor('#4e4838')
C_BORDER = colors.HexColor('#645c45')
C_ACCENT = colors.HexColor('#d4bb6f')
C_ACCENT2 = colors.HexColor('#7255cc')
C_TEXT = colors.HexColor('#e4e3e1')
C_MUTED = colors.HexColor('#88857e')
C_GREEN = colors.HexColor('#52B788')
C_RED = colors.HexColor('#E5383B')
C_ORANGE = colors.HexColor('#E9C46A')
C_CYAN = colors.HexColor('#00D2FF')

# Styles
styles = getSampleStyleSheet()

title_style = ParagraphStyle('Title', fontName='NotoSerifSC-Bold', fontSize=28, 
    textColor=C_ACCENT, spaceAfter=8, alignment=TA_CENTER, leading=34)
subtitle_style = ParagraphStyle('Subtitle', fontName='NotoSerifSC', fontSize=14,
    textColor=C_MUTED, spaceAfter=20, alignment=TA_CENTER, leading=18)
h1_style = ParagraphStyle('H1', fontName='NotoSerifSC-Bold', fontSize=18,
    textColor=C_ACCENT, spaceBefore=20, spaceAfter=12, leading=24)
h2_style = ParagraphStyle('H2', fontName='NotoSerifSC-Bold', fontSize=14,
    textColor=C_CYAN, spaceBefore=14, spaceAfter=8, leading=18)
h3_style = ParagraphStyle('H3', fontName='NotoSerifSC-Bold', fontSize=11,
    textColor=C_ACCENT2, spaceBefore=10, spaceAfter=6, leading=14)
body_style = ParagraphStyle('Body', fontName='NotoSerifSC', fontSize=9.5,
    textColor=C_TEXT, spaceAfter=6, alignment=TA_JUSTIFY, leading=14,
    firstLineIndent=0)
body_indent = ParagraphStyle('BodyIndent', fontName='NotoSerifSC', fontSize=9,
    textColor=C_MUTED, spaceAfter=4, leftIndent=15, leading=13)
bullet_style = ParagraphStyle('Bullet', fontName='NotoSerifSC', fontSize=9.5,
    textColor=C_TEXT, spaceAfter=3, leftIndent=20, bulletIndent=8, leading=13)
caption_style = ParagraphStyle('Caption', fontName='NotoSerifSC', fontSize=8,
    textColor=C_MUTED, alignment=TA_CENTER, spaceAfter=8)
cell_style = ParagraphStyle('Cell', fontName='NotoSerifSC', fontSize=8,
    textColor=C_TEXT, leading=11, alignment=TA_LEFT)
cell_bold = ParagraphStyle('CellBold', fontName='NotoSerifSC-Bold', fontSize=8,
    textColor=C_TEXT, leading=11)
cell_center = ParagraphStyle('CellCenter', fontName='NotoSerifSC', fontSize=8,
    textColor=C_TEXT, leading=11, alignment=TA_CENTER)
cell_green = ParagraphStyle('CellGreen', fontName='NotoSerifSC', fontSize=8,
    textColor=C_GREEN, leading=11, alignment=TA_CENTER)
cell_red = ParagraphStyle('CellRed', fontName='NotoSerifSC', fontSize=8,
    textColor=C_RED, leading=11, alignment=TA_CENTER)
cell_orange = ParagraphStyle('CellOrange', fontName='NotoSerifSC', fontSize=8,
    textColor=C_ORANGE, leading=11, alignment=TA_CENTER)

output_path = "/home/z/my-project/download/NeuroCLI_Kiyaslama_Raporu.pdf"

doc = SimpleDocTemplate(output_path, pagesize=A4,
    leftMargin=18*mm, rightMargin=18*mm, topMargin=20*mm, bottomMargin=20*mm)

story = []

# ===== COVER =====
story.append(Spacer(1, 80*mm))
story.append(Paragraph("NEUROCLI", title_style))
story.append(Paragraph("Rekabetci Ozellik Kiyaslama Raporu", subtitle_style))
story.append(Spacer(1, 10*mm))
story.append(HRFlowable(width="60%", thickness=1, color=C_BORDER, spaceAfter=10, spaceBefore=0))
story.append(Paragraph("Claude Code | Gemini CLI | OpenCode/Crush | Kilo Code", 
    ParagraphStyle('CoverTools', fontName='NotoSerifSC', fontSize=11, textColor=C_MUTED, alignment=TA_CENTER, leading=14)))
story.append(Spacer(1, 15*mm))
story.append(Paragraph("Temmuz 2026", 
    ParagraphStyle('Date', fontName='NotoSerifSC', fontSize=10, textColor=C_ACCENT, alignment=TA_CENTER)))
story.append(Spacer(1, 5*mm))
story.append(Paragraph("Bu rapor, NeuroCLI projesini sektorundeki 4 ana rakiple karsilastirmali olarak incelemekte, benzersiz guclu yonleri ve gelistirilmesi gereken alanlari detaylandirmaktadir.",
    ParagraphStyle('CoverDesc', fontName='NotoSerifSC', fontSize=9, textColor=C_MUTED, alignment=TA_CENTER, leading=14, leftIndent=30*mm, rightIndent=30*mm)))
story.append(PageBreak())

# ===== SECTION 1: EXECUTIVE SUMMARY =====
story.append(Paragraph("1. Yonetici Ozeti", h1_style))
story.append(Paragraph(
    "NeuroCLI, terminal tabanli bir AI kodlama asistani olarak, OpenRouter uzerinden 23 ucretsiz model sunarak sektordeki en uygun maliyetli cozum olarak one cikiyor. "
    "Ancak rakiplerle karsilastirildiginda, MCP protokol destegi, IDE entegrasyonu, sandbox yalitimi ve otomatik tamamlama gibi kritik alanlarda onemli bosluklar bulunuyor. "
    "Bu rapor, 5 araci 17 kategoride 60'tan fazla ozellik acisindan karsilastirmakta ve NeuroCLI'nin gelistirme yol haritasini onceliklendirmektedir.", body_style))

story.append(Paragraph(
    "Arastirma sonuclarina gore, NeuroCLI'nin en buyuk avantaji ucretsiz model ekosistemi ve derinlemesine baglam yonetimi sistemidir. "
    "5 katmanli sikistirma stratejisi, danisman sistemi ve LSP entegrasyonu gibi benzersiz ozellikler, rakiplerin cogunda bulunmayan yetenekler sunmaktadir. "
    "Bununla birlikte, MCP destegi ve IDE entegrasyonu gibi olmazsa olmaz ozelliklerin eksikligi, kullanicilarin diger araclarla gecis yapmasina neden olabilecek kritik engellerdir.", body_style))

# Score summary table
story.append(Spacer(1, 5*mm))
score_data = [
    [Paragraph('<b>Arac</b>', cell_bold), Paragraph('<b>Toplam Ozellik</b>', cell_bold), 
     Paragraph('<b>Benzersiz Avantaj</b>', cell_bold), Paragraph('<b>En Buyuk Eksik</b>', cell_bold)],
    [Paragraph('NeuroCLI', cell_bold), Paragraph('~45', cell_center), 
     Paragraph('Ucretsiz modeller + Danisman + LSP + 5 katmanli sikistirma', cell_style), Paragraph('MCP + IDE + Sandbox', cell_red)],
    [Paragraph('Claude Code', cell_bold), Paragraph('~65', cell_center), 
     Paragraph('En olgun ekosistem + 3000+ MCP + 125K stars', cell_style), Paragraph('Sadece Anthropic modeller', cell_orange)],
    [Paragraph('Gemini CLI', cell_bold), Paragraph('~55', cell_center), 
     Paragraph('1M baglam + A2A protokol + 5 sandbox yontemi', cell_style), Paragraph('Sadece Google modeller', cell_orange)],
    [Paragraph('OpenCode/Crush', cell_bold), Paragraph('~60', cell_center), 
     Paragraph('Go TUI + 75+ provider + Ozel arac SDK', cell_style), Paragraph('Arsivlendi (Crush\'a gecti)', cell_red)],
    [Paragraph('Kilo Code', cell_bold), Paragraph('~70', cell_center), 
     Paragraph('Sandbox + Marketplace + 500+ model + 3M kullanci', cell_style), Paragraph('v7 diff regression', cell_orange)],
]

avail_w = A4[0] - 36*mm
score_table = Table(score_data, colWidths=[avail_w*0.15, avail_w*0.12, avail_w*0.45, avail_w*0.28])
score_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), C_HEADER),
    ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor('#0f3460')),
    ('TEXTCOLOR', (0, 0), (-1, -1), C_TEXT),
    ('GRID', (0, 0), (-1, -1), 0.5, C_BORDER),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, -1), 4),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
]))
story.append(score_table)
story.append(Paragraph("Tablo 1: Genel Degerlendirme Ozeti", caption_style))

# ===== SECTION 2: FEATURE MATRIX =====
story.append(Paragraph("2. Detayli Ozellik Kiyaslama Matrisi", h1_style))
story.append(Paragraph(
    "Asagidaki tabloda 5 arac, temel ozellik kategorilerinde karsilastirilmaktadir. Her ozellik icin durum gostergeleri kullanilmistir: "
    "yesil (tam destek), kirmizi (destek yok), turuncu (kismi destek). NeuroCLI'nin guclu yonleri vurgulanirken, eksik oldugu alanlar net olarak isaretlenmistir.", body_style))

# Compact feature matrix - key categories
categories = [
    ("2.1 Temel Ozellikler", [
        ("Interaktif REPL", "✅", "✅", "✅", "✅", "✅"),
        ("Tek Seferlik Mod", "✅", "✅", "✅", "✅", "✅"),
        ("Headless/CI Modu", "❌", "✅", "✅", "✅", "✅"),
        ("Arka Plan Agentleri", "❌", "✅", "❌", "❌", "❌"),
    ]),
    ("2.2 Arac Mimarisi", [
        ("Yerlesik Ajan Sayisi", "8", "1+", "4+", "4+", "5+"),
        ("Sub-agent Destegi", "✅", "✅", "✅", "✅", "✅"),
        ("Paralel Calistirma", "✅", "✅", "✅", "✅", "✅"),
        ("Ozel Ajan Tanimlama", "⚠️", "✅", "✅", "✅", "✅"),
        ("Ajanlar Arasi Mesajlasma", "✅", "❌", "❌", "❌", "❌"),
        ("Uzaktan Ajan (A2A)", "❌", "❌", "✅", "❌", "⚠️"),
    ]),
    ("2.3 Arac Kapasiteleri", [
        ("Dosya Islemleri", "✅ 7 tool", "✅", "✅", "✅", "✅"),
        ("Bash Calistirma", "✅", "✅", "✅", "✅", "✅"),
        ("Git Entegrasyonu", "✅ 18 alt-komut", "✅", "✅", "✅", "✅"),
        ("Web Arama", "✅ DuckDuckGo", "✅", "✅ Google", "✅", "✅"),
        ("LSP Entegrasyonu", "✅ 4 dil", "❌", "❌", "⚠️ Deneysel", "❌"),
        ("Tarayici Ajanı", "❌", "✅", "✅", "❌", "⚠️"),
    ]),
    ("2.4 Baglam Yonetimi", [
        ("Otomatik Sikistirma", "✅ 5 katman", "✅ 1 katman", "⚠️ Subagent", "✅ 1 katman", "✅ 1 katman"),
        ("Proje Baglam Dosyasi", "✅ NEURO.md", "✅ CLAUDE.md", "✅ GEMINI.md", "✅ AGENTS.md", "✅ AGENTS.md"),
        ("Canli Dosya Izleme", "✅ 5s polling", "❌", "❌", "❌", "❌"),
        ("Repo Haritasi", "✅ 5 dil", "❌", "❌", "❌", "✅ Indexing"),
        ("Kalici Bellek", "✅ save/recall", "❌", "✅ Auto Memory", "❌", "⚠️ Deprecated"),
    ]),
    ("2.5 MCP Destegi", [
        ("MCP Protokol", "❌", "✅ 3000+ ent.", "✅ Full", "✅ Full+OAuth", "✅ Full+Market"),
        ("MCP Yapilandirma", "❌", "✅ .mcp.json", "✅ settings.json", "✅ opencode.json", "✅ kilo.jsonc"),
    ]),
    ("2.6 Izin ve Guvenlik", [
        ("Onay Modlari", "⚠️ 2 mod", "✅ 3 mod", "✅ 4 mod", "✅ 3 kademe", "✅ Granular"),
        ("Tehlikeli Komut Algilama", "✅ Regex", "✅ AI siniflandirici", "⚠️", "⚠️ Pattern", "✅ Sandbox+pattern"),
        ("Sandbox/Yalitim", "❌", "✅ Seatbelt+Bwrap", "✅ 5 yontem", "❌", "✅ Bwrap+seccomp"),
    ]),
    ("2.7 IDE Entegrasyonu", [
        ("VS Code Eklentisi", "❌", "✅", "✅", "✅", "✅"),
        ("JetBrains Eklentisi", "❌", "✅", "✅ ACP", "❌", "✅ Kotlin"),
        ("Diff Goruntuleyici", "❌", "✅ Inline+IDE", "✅ IDE diff", "✅ TUI diff", "⚠️"),
    ]),
    ("2.8 UI/UX", [
        ("Tema Sayisi", "4", "2", "3", "11+", "Yapilandirilabilir"),
        ("Otomatik Tamamlama", "❌", "✅", "✅", "✅", "✅ FIM"),
        ("Sozdizimi Vurgulama", "❌", "✅", "✅", "✅", "✅"),
    ]),
    ("2.9 Model Destegi", [
        ("Ucretsiz Model", "23", "0", "1 sinirli", "0 (BYOK)", "200 req/saat"),
        ("Coklu Saglayici", "⚠️ OpenRouter", "❌ Anthropic", "❌ Google", "✅ 75+", "✅ 500+"),
        ("Yerel Model (Ollama)", "❌", "❌", "❌", "✅", "✅"),
        ("Maliyet (Gun)", "$0", "$4-13", "Ucretsiz sinirli", "Kullanim bazli", "$0+ BYOK"),
    ]),
    ("2.10 Geri Alma / Diff", [
        ("Geri Alma (Undo)", "⚠️ CLI yok", "✅ /rewind", "✅ /rewind+/restore", "✅ /undo+/redo", "✅ /undo+/redo"),
        ("Diff Onizleme", "❌", "✅ Inline+IDE", "✅ IDE diff", "✅ TUI diff", "⚠️ Kismi"),
    ]),
]

for cat_name, cat_features in categories:
    story.append(Paragraph(cat_name, h2_style))
    
    header_row = [Paragraph('<b>Ozellik</b>', cell_bold), 
                  Paragraph('<b>NeuroCLI</b>', cell_bold),
                  Paragraph('<b>Claude Code</b>', cell_bold),
                  Paragraph('<b>Gemini CLI</b>', cell_bold),
                  Paragraph('<b>OpenCode</b>', cell_bold),
                  Paragraph('<b>Kilo Code</b>', cell_bold)]
    
    data = [header_row]
    for feat, n, c, g, o, k in cat_features:
        def style_cell(val):
            if val.startswith("✅"): return Paragraph(val, cell_green)
            elif val.startswith("❌"): return Paragraph(val, cell_red)
            elif val.startswith("⚠️"): return Paragraph(val, cell_orange)
            else: return Paragraph(val, cell_center)
        
        data.append([Paragraph(feat, cell_style), style_cell(n), style_cell(c), 
                     style_cell(g), style_cell(o), style_cell(k)])
    
    col_w = [avail_w*0.22, avail_w*0.12, avail_w*0.15, avail_w*0.17, avail_w*0.17, avail_w*0.17]
    t = Table(data, colWidths=col_w)
    
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), C_HEADER),
        ('BACKGROUND', (1, 1), (1, -1), colors.HexColor('#0f3460')),
        ('GRID', (0, 0), (-1, -1), 0.5, C_BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor('#151513'), colors.HexColor('#1d1c19')]),
    ]))
    story.append(t)
    story.append(Spacer(1, 3*mm))

# ===== SECTION 3: NEUROCLI UNIQUE STRENGTHS =====
story.append(Paragraph("3. NeuroCLI Benzersiz Guclu Yonleri", h1_style))
story.append(Paragraph(
    "NeuroCLI, rakiplerle karsilastirildiginda bazi alanlarda onemli avantajlara sahip. Bu bolumde, diger araclarda bulunmayan veya cok sinirli olan "
    "benzersiz ozellikleri detaylandiriyoruz. Bu avantajlar, NeuroCLI'nin piyasadaki konumunu belirleyen ve gelistirme stratejisinin temelini olusturan "
    "oenmli farkliliklardir.", body_style))

strengths_detail = [
    ("3.1 23 Ucretsiz Model ile $0 Maliyet", 
     "NeuroCLI'nin en belirgin avantaji, OpenRouter uzerinden 23 tamamen ucretsiz model sunmasidir. "
     "Claude Code kullanicilari gunluk $4-13 harcarken, Gemini CLI sinirli gunluk istek kotalariyla calisirken, "
     "OpenCode ve Kilo Code BYOK (Kendi Anahtarini Getir) modeliyle calisirken, NeuroCLI kullanicilari "
     "hicbir API anahtari veya odeme yapmadan tam islevsel bir AI kodlama asistani kullanabilmektedir. "
     "Qwen3 Coder (1M baglam), Nemotron 3 Super 120B, Cohere North Mini Code ve Gemma 4 31B gibi "
     "guclu modeller ucretsiz olarak sunulmaktadir. Bu, ogrenciler, acik kaynak gelistiricileri ve "
     "butce kisitlamasi olan ekipler icin benzersiz bir deger teklifidir."),
    
    ("3.2 5 Katmanli Derin Baglam Sikistirma",
     "NeuroCLI, sektordeki en derin sikistirma stratejisini sunmaktadir. 5 progresif katman sirasiyla: "
     "(1) Tool Budget - arac ciktisini 5K tokena kesme, (2) Snip - eski turmalari silme, son 40 mesaji tutma, "
     "(3) Micro - her mesaji 500+ karakterde ozetleme, (4) Session Memory - LLM tabanli anahtar gercek cikarma, "
     "(5) Full Collapse - butun konusmayi LLM ile ozetleme. Bu katmanli yaklasim, tek katmanli sikistirma "
     "kullanan rakiplere gore cok daha verimli baglam yonetimi saglar ve uzun oturumlarda kalite kaybini minimize eder."),
    
    ("3.3 Danisman Sistemi (Advisor)",
     "NeuroCLI'ya ozgu bu sistem, gorev sirasinda ikinci bir modele danisarak kaliteyi arttirir. "
     "6 farkli tetikleyici vardir: gorev oncesi yaklasim degerlendirmesi (before_approach), tekrar eden hata "
     "algilama (recurring_error), gorev tamamlama oncesi kontrol (before_complete), karmasik kararlar "
     "(complex_decision), guvenlik hassasiyeti (security_sensitive) ve manuel istek. Ozellikle tekrar eden "
     "hata algilama, kelime benzerligi ile benzer hata desenlerini taniyarak gereksiz donguleri onler. "
     "Bu sistem hicbir rakipte bulunmamaktadir ve otonom ajan kalitesini onemli olcude arttirir."),
    
    ("3.4 LSP Entegrasyonu",
     "Language Server Protocol destegi, NeuroCLI'ya kod zekasi yetenekleri kazandirir. TypeScript, Python, Go "
     "ve Rust dilleri icin otomatik LSP baslatma, diagnostic bilgilerini LLM baglamina enjeksiyon, "
     "go-to-definition ve find-references ozellikleri sunulmaktadir. Bu yetenek, ajanin kod tabanini "
     "daha derinlemesine anlamasini ve daha dogru duzeltmeler yapmasini saglar. Rakipler arasinda sadece "
     "OpenCode'da deneysel bir LSP araci bulunmakta, digerlerinde bu yetenek tamamen yoktur."),
    
    ("3.5 Repo Haritasi ile Proje Anlayisi",
     "NeuroCLI, ripgrep ve regex tabanli tanim cikarma ile otomatik kod haritasi olusturur. "
     "5 dilde (TypeScript, Python, Rust, Go, Java) sinif, fonksiyon ve interface tanimlarini cikarir, "
     "import/reference iliskilerini tespit eder ve onbellekli kompakt bir gosterim sunar. "
     "Bu sayede ajan, dosya dosya okumadan tum projenin yapisini anlayabilir. Kilo Code'daki "
     "codebase indexing ozelligine benzer ancak daha fazla dil destegi ve detayli tanim cikarma sunar."),
    
    ("3.6 20 Olaylik Hook Sistemi",
     "NeuroCLI'nin hook sistemi 8 kategoride 20 lifecycle olayini destekler: Session (baslangic/bitis), "
     "Agent (oncesi/sonrasi/subagent), Model (oncesi/sonrasi), Tool (oncesi/sonrasi/basarisizlik), "
     "Permission (istek/reddetme), User (prompt gonderme), Context (sikistirma oncesi/sonrasi) ve "
     "Environment (dosya degisikligi/dizin/config). 4 hook tipi (command, http, prompt, agent) ve "
     "4 sonuc turu (continue, block, modify, retry) ile genisletilebilirlik sunar. "
     "Bu kapsam, rakiplerin hook sistemlerinden cok daha detaylidir."),
    
    ("3.7 NEURO.md @import ve Canli Izleme",
     "Proje baglam dosyasi sistemi 5 katmanli hiyerarsi sunar: global, proje, proje-alt, lokal ve kurallar. "
     "Benzersiz olarak @import direktifiyle baska dosyalari icerme ve 5 saniyelik polling ile canli "
     "guncelleme destegi vardir. Bu, CLAUDE.md veya GEMINI.md'nin statik yapısına kiyasla cok daha "
     "dinamik bir baglam yonetimi saglar. Gelistirici NEURO.md'yi guncellediginde, ajan otomatik "
     "olarak yeni baglami alir ve oturumu yeniden baslatmaya gerek kalmaz."),
]

for title, content in strengths_detail:
    story.append(Paragraph(title, h2_style))
    story.append(Paragraph(content, body_style))

# ===== SECTION 4: GAP ANALYSIS =====
story.append(Paragraph("4. Eksik Ozellik Analizi ve Onceliklendirme", h1_style))
story.append(Paragraph(
    "Bu bolumde, NeuroCLI'nin rakiplere kiyasla eksik oldugu ozellikler oncelik seviyelerine gore siniflandirilmaktadir. "
    "P0 (Kritik) eksiklikler, urunun rekabet edebilirligini dogrudan etkileyen ve biran once tamamlanmasi gereken ozelliklerdir. "
    "P1 (Yuksek) eksiklikler, kullanicilarin sikca ihtiyac duyacagi ve urun deneyimini onemli olcude etkileyen ozelliklerdir. "
    "P2 (Orta) ve P3 (Dusuk) eksiklikler ise uzun vadeli gelistirme yol haritasinda yer almalidir.", body_style))

# P0 Gaps
story.append(Paragraph("4.1 P0 - Kritik Eksiklikler", h2_style))

p0_gaps = [
    ("MCP Protokol Destegi", 
     "Tum 4 rakip MCP'yi desteklemektedir. Claude Code 3000+ MCP entegrasyonu ile en genis ekosisteme sahipken, "
     "Kilo Code bir MCP pazaryeri bile sunmaktadir. MCP destegi olmadan, NeuroCLI dis araclara, veritabanlarina, "
     "API'lere ve servislere baglanamaz. Bu, modern AI kodlama asistanlari icin olmazsa olmaz bir ozelliktir. "
     "Uygulama icin stdio, HTTP ve SSE transport destegi ile bir MCP istemcisi gelistirilmelidir. "
     "Ayrica .neuro/mcp.json yapilandirma dosyasi ve /mcp slash komutu eklenmelidir."),
    
    ("Gercek Onay Istemi (Approval Prompt)",
     "Su anda tehlikeli islemler icin kullaniciya gercek bir soru sorulmamakta, otomatik olarak onay verilmektedir. "
     "Bu, veri kaybi veya sisteme zarar verme riskini artirmaktadir. Tum rakiplerde kullanicidan onay isteyen "
     "interaktif bir mekanizma bulunmaktadir. inquirer veya readline arayuzu ile kullaniciya risk seviyesi, "
     "islem detaylari ve onay/red secenekleri sunulmalidir."),
    
    ("Oturum Devam Ettirme CLI Komutu",
     "SessionManager.load() fonksiyonu mevcut olmakla birlikte, CLI uzerinden /resume veya "
     "neuro --continue komutu ile erisilememektedir. Kullanicilar onceki oturumlarina donmek istediklerinde "
     "bu ozellik kritik oneme sahiptir. Claude Code -c ve -r flaglari, Gemini --resume, OpenCode Ctrl+A "
     "ve Kilo --continue ile bu ozelligi sunmaktadir."),
    
    ("Otomatik Tamamlama (Tab Completion)",
     "Slash komutlari, dosya yollari, model isimleri ve ajan isimleri icin tab-tamamlama, "
     "kullanici deneyimini dogrudan etkileyen temel bir ozelliktir. Tum rakiplerde farkli sekillerde "
     "de olsa bir tamamlama mekanizmasi bulunmaktadir. readline arayuzunun completer fonksiyonu "
     "kullanilarak hizlica implemente edilebilir."),
]

for title, content in p0_gaps:
    story.append(Paragraph(title, h3_style))
    story.append(Paragraph(content, body_style))

# P1 Gaps
story.append(Paragraph("4.2 P1 - Yuksek Oncelikli Eksiklikler", h2_style))

p1_gaps = [
    ("VS Code Eklentisi",
     "Tum 4 rakibin VS Code eklentisi bulunmaktadir. VS Code, gelistiricilerin %74'unun kullandigi en populer "
     "IDE'dir ve burada yokluk, ciddi bir erisim engeli olusturur. Eklenti, diff goruntuleme, dosya referanslari, "
     "context paylasimi ve hizli erisim tuslari sunmalidir. Webview API kullanilarak gelistirilebilir."),
    
    ("Diff Onizleme UI",
     "Dosya degisikliklerini onizleme ve onay mekanizmasi, kodlama asistanlarinin guvenilirligini artiran "
     "temel bir ozelliktir. Claude Code inline ve IDE diff goruntuleme sunarken, Gemini CLI VS Code diff "
     "viewer entegrasyonu saglar. NeuroCLI'da apply_diff ve edit_file araclari degisiklikleri dogrudan "
     "uygulamakta, kullanicinin ongormesine ve onaylamasina firsat vermemektedir."),
    
    ("Sandbox/Yalitim Sistemi",
     "Isletim sistemi seviyesinde proses yalitimi, guvenlik acisindan kritik oneme sahiptir. "
     "Claude Code Seatbelt (macOS) ve Bubblewrap (Linux), Gemini CLI 5 farkli yalitim yontemi, "
     "Kilo Code Bubblewrap+seccomp+network namespace kullanmaktadir. NeuroCLI'da ise "
     "run_command araci dogrudan sistemde calismakta, potansiyel olarak tehlikeli islemleri "
     "onlemek icin yalitim katmani bulunmamaktadir."),
    
    ("Ozel Araclar SDK",
     "Kullanicilarin kendi araclari yazmasi icin bir SDK/plugin sistemi, genisletilebilirlik acisindan "
     "kritiktir. Claude Code Plugin SDK, OpenCode @opencode-ai/plugin (Zod sema dogrulama), "
     "Kilo Code custom tools sunmaktadir. NeuroCLI'da ToolRegistry var ancak dis gelistiriciler "
     "icin bir SDK veya dokumantasyon bulunmamaktadir."),
    
    ("Headless/CI Modu",
     "CI/CD boru hatlarinda otomatik calisma modu, ekip ortamlarinda onemli bir ihtiyactir. "
     "Claude Code --max-turns ve --allowedTools flaglari, Gemini headless modu, "
     "OpenCode -p -f json, Kilo --auto flagi ile bu ozelligi sunmaktadir. "
     "NeuroCLI'da neuro ask komutu tek seferlik calisma sunmaktadir ancak cok adimli otonom "
     "calisma ve JSON cikti destegi bulunmamaktadir."),
]

for title, content in p1_gaps:
    story.append(Paragraph(title, h3_style))
    story.append(Paragraph(content, body_style))

# ===== SECTION 5: COMPETITIVE POSITIONING =====
story.append(Paragraph("5. Rekabetci Konumlandirma", h1_style))
story.append(Paragraph(
    "NeuroCLI'nin piyasadaki konumu, ucretsiz model ekosistemi ve derin teknik yetenekleri uzerine kurulmalidir. "
    "Asagidaki tablo, her aracin hedef kisisini ve farklilik stratejisini ozetlemektedir.", body_style))

pos_data = [
    [Paragraph('<b>Arac</b>', cell_bold), Paragraph('<b>Hedef Kisi</b>', cell_bold), 
     Paragraph('<b>Farklilik Stratejisi</b>', cell_bold), Paragraph('<b>Zayif Nokta</b>', cell_bold)],
    [Paragraph('NeuroCLI', cell_bold), Paragraph('Ogrenci, acik kaynak gelistirici, butce kisitli ekipler', cell_style), 
     Paragraph('Ucretsiz + derin baglam + danisman sistemi', cell_style), Paragraph('MCP yok, IDE yok, sandbox yok', cell_red)],
    [Paragraph('Claude Code', cell_bold), Paragraph('Profesyonel gelistiriciler, sirketler', cell_style), 
     Paragraph('En olgun ekosistem, 3000+ MCP, kapsamli IDE entegrasyonu', cell_style), Paragraph('Sadece Anthropic, pahali', cell_orange)],
    [Paragraph('Gemini CLI', cell_bold), Paragraph('Google ekosistem kullanicilari, arastirmacilar', cell_style), 
     Paragraph('1M baglam, A2A protokol, 5 sandbox yontemi', cell_style), Paragraph('Google bagimli, sinirli ucretsiz', cell_orange)],
    [Paragraph('OpenCode', cell_bold), Paragraph('Acik kaynak toplulugu, Go gelistiricileri', cell_style), 
     Paragraph('Go TUI, 75+ provider, ozel arac SDK', cell_style), Paragraph('Arsivlendi, Crush\'a gecti', cell_red)],
    [Paragraph('Kilo Code', cell_bold), Paragraph('VS Code/JetBrains kullanicilari, sirketler', cell_style), 
     Paragraph('Sandbox, Marketplace, 500+ model, 3M kullanci', cell_style), Paragraph('Diff regression, karmasik yapilandirma', cell_orange)],
]

pos_table = Table(pos_data, colWidths=[avail_w*0.13, avail_w*0.25, avail_w*0.32, avail_w*0.30])
pos_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), C_HEADER),
    ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor('#0f3460')),
    ('GRID', (0, 0), (-1, -1), 0.5, C_BORDER),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, -1), 4),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ('ROWBACKGROUNDS', (0, 2), (-1, -1), [colors.HexColor('#151513'), colors.HexColor('#1d1c19')]),
]))
story.append(pos_table)
story.append(Paragraph("Tablo 2: Rekabetci Konumlandirma Matrisi", caption_style))

# ===== SECTION 6: ROADMAP =====
story.append(Paragraph("6. Oncelikli Gelistirme Yol Haritasi", h1_style))
story.append(Paragraph(
    "Asagidaki yol haritasi, eksik ozelliklerin etki puani ve uygulama zorluguna gore onceliklendirilmis "
    "halini sunmaktadir. Her asama, NeuroCLI'nin rekabet gucunu arttiracak ve kullnici deneyimini "
    "iyilestirecek kritik adimlari icermektedir.", body_style))

roadmap_data = [
    [Paragraph('<b>Asama</b>', cell_bold), Paragraph('<b>Sure</b>', cell_bold), 
     Paragraph('<b>Ozellikler</b>', cell_bold), Paragraph('<b>Etki</b>', cell_bold)],
    [Paragraph('Asama 1\nKritik', ParagraphStyle('P0Cell', fontName='NotoSerifSC-Bold', fontSize=8, textColor=C_RED, alignment=TA_CENTER, leading=11)), 
     Paragraph('1-2 Hafta', cell_center),
     Paragraph('MCP istemcisi, Gercek onay istemi, /resume komutu, Tab tamamlama', cell_style),
     Paragraph('Rekabet edebilirlik icin kritik', cell_red)],
    [Paragraph('Asama 2\nYuksek', ParagraphStyle('P1Cell', fontName='NotoSerifSC-Bold', fontSize=8, textColor=C_ORANGE, alignment=TA_CENTER, leading=11)), 
     Paragraph('2-4 Hafta', cell_center),
     Paragraph('VS Code eklentisi, Diff onizleme UI, Sandbox yalitimi, Headless/CI modu', cell_style),
     Paragraph('Kullanici deneyiminde buyuk sicramma', cell_orange)],
    [Paragraph('Asama 3\nOrta', ParagraphStyle('P2Cell', fontName='NotoSerifSC-Bold', fontSize=8, textColor=C_CYAN, alignment=TA_CENTER, leading=11)), 
     Paragraph('1-2 Ay', cell_center),
     Paragraph('Ozel ajan dosyalari, Oturum fork, Skill sistemi, Harcama limiti, Prompt onbellek', cell_style),
     Paragraph('Urun olgunlugunu arttirir', cell_center)],
    [Paragraph('Asama 4\nDusuk', ParagraphStyle('P3Cell', fontName='NotoSerifSC-Bold', fontSize=8, textColor=C_GREEN, alignment=TA_CENTER, leading=11)), 
     Paragraph('2-3 Ay', cell_center),
     Paragraph('Tarayici ajani, Sesli giris/cikti, JetBrains eklentisi, Ollama destegi, Oturum paylasma', cell_style),
     Paragraph('Piyasa kapsamini genisletir', cell_green)],
]

road_table = Table(roadmap_data, colWidths=[avail_w*0.12, avail_w*0.12, avail_w*0.50, avail_w*0.26])
road_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), C_HEADER),
    ('GRID', (0, 0), (-1, -1), 0.5, C_BORDER),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, -1), 5),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor('#151513'), colors.HexColor('#1d1c19')]),
]))
story.append(road_table)
story.append(Paragraph("Tablo 3: Gelistirme Yol Haritasi", caption_style))

# ===== SECTION 7: SCORING =====
story.append(Paragraph("7. Skor Kiyaslamasi", h1_style))
story.append(Paragraph(
    "Her arac, 10 kategoride 10 uzerinden puanlanmistir. Puanlama, ozelligin mevcudiyeti, derinligi "
    "ve kullanici deneyimine etkisine gore yapilmistir. NeuroCLI'nin guclu oldugu alanlar (baglam yonetimi, "
    "model destegi, genisletilebilirlik) ile zayif oldugu alanlar (MCP, IDE entegrasyonu, guvenlik) "
    "net olarak gorulmektedir.", body_style))

score_card = [
    [Paragraph('<b>Kategori</b>', cell_bold), Paragraph('<b>NeuroCLI</b>', cell_bold),
     Paragraph('<b>Claude Code</b>', cell_bold), Paragraph('<b>Gemini CLI</b>', cell_bold),
     Paragraph('<b>OpenCode</b>', cell_bold), Paragraph('<b>Kilo Code</b>', cell_bold)],
    [Paragraph('Temel Ozellikler', cell_style), Paragraph('7', cell_orange), Paragraph('10', cell_green), Paragraph('9', cell_green), Paragraph('9', cell_green), Paragraph('9', cell_green)],
    [Paragraph('Arac Mimarisi', cell_style), Paragraph('9', cell_green), Paragraph('8', cell_green), Paragraph('8', cell_green), Paragraph('8', cell_green), Paragraph('8', cell_green)],
    [Paragraph('Arac Kapasiteleri', cell_style), Paragraph('8', cell_green), Paragraph('9', cell_green), Paragraph('8', cell_green), Paragraph('9', cell_green), Paragraph('8', cell_green)],
    [Paragraph('Baglam Yonetimi', cell_style), Paragraph('10', cell_green), Paragraph('7', cell_orange), Paragraph('6', cell_orange), Paragraph('7', cell_orange), Paragraph('7', cell_orange)],
    [Paragraph('MCP Destegi', cell_style), Paragraph('0', cell_red), Paragraph('10', cell_green), Paragraph('8', cell_green), Paragraph('9', cell_green), Paragraph('10', cell_green)],
    [Paragraph('Guvenlik/Izin', cell_style), Paragraph('4', cell_red), Paragraph('9', cell_green), Paragraph('9', cell_green), Paragraph('5', cell_orange), Paragraph('9', cell_green)],
    [Paragraph('IDE Entegrasyonu', cell_style), Paragraph('0', cell_red), Paragraph('10', cell_green), Paragraph('8', cell_green), Paragraph('7', cell_orange), Paragraph('9', cell_green)],
    [Paragraph('Model Destegi', cell_style), Paragraph('10', cell_green), Paragraph('4', cell_red), Paragraph('5', cell_orange), Paragraph('8', cell_green), Paragraph('9', cell_green)],
    [Paragraph('Genisletilebilirlik', cell_style), Paragraph('8', cell_green), Paragraph('9', cell_green), Paragraph('8', cell_green), Paragraph('9', cell_green), Paragraph('9', cell_green)],
    [Paragraph('UI/UX', cell_style), Paragraph('5', cell_orange), Paragraph('8', cell_green), Paragraph('7', cell_orange), Paragraph('9', cell_green), Paragraph('7', cell_orange)],
    [Paragraph('<b>TOPLAM</b>', cell_bold), Paragraph('<b>61/100</b>', ParagraphStyle('Total', fontName='NotoSerifSC-Bold', fontSize=9, textColor=C_ORANGE, alignment=TA_CENTER)),
     Paragraph('<b>84/100</b>', ParagraphStyle('TotalG', fontName='NotoSerifSC-Bold', fontSize=9, textColor=C_GREEN, alignment=TA_CENTER)),
     Paragraph('<b>68/100</b>', ParagraphStyle('TotalG2', fontName='NotoSerifSC-Bold', fontSize=9, textColor=C_GREEN, alignment=TA_CENTER)),
     Paragraph('<b>80/100</b>', ParagraphStyle('TotalG3', fontName='NotoSerifSC-Bold', fontSize=9, textColor=C_GREEN, alignment=TA_CENTER)),
     Paragraph('<b>85/100</b>', ParagraphStyle('TotalG4', fontName='NotoSerifSC-Bold', fontSize=9, textColor=C_GREEN, alignment=TA_CENTER))],
]

sc_table = Table(score_card, colWidths=[avail_w*0.22, avail_w*0.12, avail_w*0.15, avail_w*0.17, avail_w*0.17, avail_w*0.17])
sc_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), C_HEADER),
    ('BACKGROUND', (1, 1), (1, -1), colors.HexColor('#0f3460')),
    ('GRID', (0, 0), (-1, -1), 0.5, C_BORDER),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, -1), 4),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.HexColor('#151513'), colors.HexColor('#1d1c19')]),
    ('BACKGROUND', (0, -1), (-1, -1), C_HEADER),
]))
story.append(sc_table)
story.append(Paragraph("Tablo 4: Skor Kiyaslamasi (10 uzerinden)", caption_style))

story.append(Paragraph(
    "NeuroCLI toplamda 61/100 puana sahiptir. En guclu oldugu alanlar Baglam Yonetimi (10) ve Model Destegi (10) iken, "
    "en zayif oldugu alanlar MCP Destegi (0) ve IDE Entegrasyonu (0)'dir. P0 ve P1 eksikliklerin tamamlanmasi durumunda "
    "NeuroCLI'nin toplam skorunun 80+/100'e yukselecegi ongorulmektedir. Ozellikle MCP ve IDE entegrasyonunun eklenmesi, "
    "en buyuk skor artisini saglayacaktir cunku bu iki kategoride toplam 20 puan kayip soz konusudur.", body_style))

# Build PDF
doc.build(story)
print(f"PDF saved to {output_path}")
