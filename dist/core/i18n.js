// ============================================================
// NeuroCLI - Multi-language i18n System
// Support for English, Turkish, Chinese, Japanese, Spanish
// Translation keys for all UI strings, auto-detect system lang
// /lang command to switch, JSON-based translation files
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
// -----------------------------------------------------------
// Built-in translations (core UI strings)
// -----------------------------------------------------------
const TRANSLATIONS = {
    en: {
        // General
        'app.name': 'NeuroCLI',
        'app.tagline': 'AI-Powered Terminal Coding Assistant',
        'app.version': 'v{version}',
        // Modes
        'mode.auto': 'Auto mode (smart orchestration)',
        'mode.agent': 'Agent mode',
        'mode.direct': 'Direct mode',
        'mode.plan': 'Plan mode (read-only)',
        'mode.yolo': 'YOLO mode (auto-approve all)',
        // Commands
        'cmd.help': 'Show help message',
        'cmd.model': 'Switch or list models',
        'cmd.agent': 'Switch or list agents',
        'cmd.theme': 'Switch UI theme',
        'cmd.exit': 'Exit NeuroCLI',
        'cmd.clear': 'Clear terminal',
        'cmd.stats': 'Show session statistics',
        'cmd.undo': 'Undo last change',
        'cmd.redo': 'Redo undone change',
        'cmd.sandbox': 'Toggle sandbox mode',
        'cmd.style': 'Switch output style',
        'cmd.thinking': 'Toggle thinking mode',
        'cmd.skills': 'Manage skills',
        'cmd.cache': 'Manage prompt cache',
        'cmd.spending': 'Show spending report',
        'cmd.lang': 'Switch language',
        'cmd.vim': 'Toggle vim mode',
        'cmd.voice': 'Toggle voice I/O',
        'cmd.telemetry': 'Manage telemetry',
        'cmd.sync': 'Cloud sync',
        'cmd.server': 'API server',
        'cmd.dashboard': 'Web dashboard',
        // Status messages
        'status.ready': 'Ready',
        'status.processing': 'Processing...',
        'status.thinking': 'Thinking...',
        'status.streaming': 'Streaming response...',
        'status.done': 'Done',
        'status.error': 'Error',
        'status.cancelled': 'Cancelled',
        'status.approved': 'Approved',
        'status.denied': 'Denied',
        'status.saved': 'Saved',
        'status.loaded': 'Loaded',
        // Warnings
        'warn.sandbox.denied': 'Sandbox: {action} denied for {target}',
        'warn.spend.limit': 'Spending limit reached ({limit})',
        'warn.doom.loop': 'Doom loop detected: {reason}',
        'warn.ignoring': 'Ignored: {path} is in .neuroignore',
        // Info
        'info.model.switch': 'Switched to {model}',
        'info.model.router': 'Model router: {complexity} task -> {model}',
        'info.cache.hit': 'Cache hit - using cached response',
        'info.skill.activated': 'Skill activated: {name} ({trigger})',
        'info.mcp.connected': 'MCP: {count} server(s) connected',
        'info.plugins.loaded': 'Plugins: {count} loaded',
        'info.session.created': 'New session created',
        'info.session.resumed': 'Session resumed',
        'info.session.saved': 'Session saved',
        'info.session.exported': 'Session exported to {path}',
        // Errors
        'error.api.key': 'API key not found. Set OPENROUTER_API_KEY environment variable.',
        'error.api.request': 'API request failed: {message}',
        'error.api.timeout': 'API request timed out',
        'error.model.not_found': 'Model not found: {model}',
        'error.agent.not_found': 'Agent not found: {agent}',
        'error.tool.not_found': 'Tool not found: {tool}',
        'error.session.not_found': 'Session not found: {id}',
        'error.file.not_found': 'File not found: {path}',
        'error.file.read': 'Failed to read file: {path}',
        'error.file.write': 'Failed to write file: {path}',
        // Approval
        'approval.request': 'Approve {tool} call? (risk: {risk})',
        'approval.auto_approved': 'Auto-approved: {tool}',
        'approval.show_diff': 'Showing diff preview...',
        // Prompt
        'prompt.input': 'You',
        'prompt.multiline': 'Multi-line mode (Ctrl+D to submit, Ctrl+C to cancel)',
        // Token usage
        'usage.tokens': 'Tokens: {input} in / {output} out',
        'usage.cost': 'Cost: ${cost}',
        'usage.model': 'Model: {model}',
        // i18n
        'i18n.current': 'Current language: {locale}',
        'i18n.switched': 'Language switched to {locale}',
        'i18n.available': 'Available languages: {locales}',
        // Vim
        'vim.enabled': 'Vim mode enabled. Press Esc to enter normal mode.',
        'vim.disabled': 'Vim mode disabled.',
        'vim.mode.normal': 'NORMAL',
        'vim.mode.insert': 'INSERT',
        'vim.mode.visual': 'VISUAL',
        'vim.mode.command': 'CMD',
        // Voice
        'voice.enabled': 'Voice I/O enabled.',
        'voice.disabled': 'Voice I/O disabled.',
        // Telemetry
        'telemetry.enabled': 'Telemetry enabled. No PII is collected.',
        'telemetry.disabled': 'Telemetry disabled.',
        // Goodbye
        'goodbye': 'Goodbye! Happy coding!',
    },
    tr: {
        'app.name': 'NeuroCLI',
        'app.tagline': 'Yapay Zeka Destekli Terminal Kodlama Asistanı',
        'app.version': 'v{version}',
        'mode.auto': 'Otomatik mod (akıllı orkestrasyon)',
        'mode.agent': 'Ajan modu',
        'mode.direct': 'Doğrudan mod',
        'mode.plan': 'Plan modu (salt okunur)',
        'mode.yolo': 'YOLO modu (hepsini otomatik onayla)',
        'cmd.help': 'Yardım mesajını göster',
        'cmd.model': 'Model değiştir veya listele',
        'cmd.agent': 'Ajan değiştir veya listele',
        'cmd.theme': 'UI temasını değiştir',
        'cmd.exit': 'NeuroCLI\'den çık',
        'cmd.clear': 'Terminali temizle',
        'cmd.stats': 'Oturum istatistiklerini göster',
        'cmd.undo': 'Son değişikliği geri al',
        'cmd.redo': 'Geri alınan değişikliği tekrarla',
        'cmd.sandbox': 'Kum havuzu modunu aç/kapat',
        'cmd.style': 'Çıktı stilini değiştir',
        'cmd.thinking': 'Düşünme modunu aç/kapat',
        'cmd.skills': 'Yetenekleri yönet',
        'cmd.cache': 'İstem önbelleğini yönet',
        'cmd.spending': 'Harcama raporunu göster',
        'cmd.lang': 'Dili değiştir',
        'cmd.vim': 'Vim modunu aç/kapat',
        'cmd.voice': 'Ses G/Ç\'sini aç/kapat',
        'cmd.telemetry': 'Telemetriyi yönet',
        'cmd.sync': 'Bulut senkronizasyonu',
        'cmd.server': 'API sunucusu',
        'cmd.dashboard': 'Web paneli',
        'status.ready': 'Hazır',
        'status.processing': 'İşleniyor...',
        'status.thinking': 'Düşünülüyor...',
        'status.streaming': 'Yanıt akışı...',
        'status.done': 'Tamamlandı',
        'status.error': 'Hata',
        'status.cancelled': 'İptal edildi',
        'status.approved': 'Onaylandı',
        'status.denied': 'Reddedildi',
        'status.saved': 'Kaydedildi',
        'status.loaded': 'Yüklendi',
        'warn.sandbox.denied': 'Kum havuzu: {action} için {target} reddedildi',
        'warn.spend.limit': 'Harcama sınırına ulaşıldı ({limit})',
        'warn.doom.loop': 'Kıyamet döngüsü tespit edildi: {reason}',
        'warn.ignoring': 'Yoksayıldı: {path} .neuroignore\'da',
        'info.model.switch': '{model} modeline geçildi',
        'info.model.router': 'Model yönlendirici: {complexity} görev -> {model}',
        'info.cache.hit': 'Önbellek isabeti - önbelleğe alınmış yanıt kullanılıyor',
        'info.skill.activated': 'Yetenek etkinleştirildi: {name} ({trigger})',
        'info.mcp.connected': 'MCP: {count} sunucu bağlandı',
        'info.plugins.loaded': 'Eklentiler: {count} yüklendi',
        'info.session.created': 'Yeni oturum oluşturuldu',
        'info.session.resumed': 'Oturum devam ettirildi',
        'info.session.saved': 'Oturum kaydedildi',
        'info.session.exported': 'Oturum {path} konumuna dışa aktarıldı',
        'error.api.key': 'API anahtarı bulunamadı. OPENROUTER_API_KEY ortam değişkenini ayarlayın.',
        'error.api.request': 'API isteği başarısız: {message}',
        'error.api.timeout': 'API isteği zaman aşımına uğradı',
        'error.model.not_found': 'Model bulunamadı: {model}',
        'error.agent.not_found': 'Ajan bulunamadı: {agent}',
        'error.tool.not_found': 'Araç bulunamadı: {tool}',
        'error.session.not_found': 'Oturum bulunamadı: {id}',
        'error.file.not_found': 'Dosya bulunamadı: {path}',
        'error.file.read': 'Dosya okunamadı: {path}',
        'error.file.write': 'Dosya yazılamadı: {path}',
        'approval.request': '{tool} çağrısını onayla? (risk: {risk})',
        'approval.auto_approved': 'Otomatik onaylandı: {tool}',
        'approval.show_diff': 'Fark önizlemesi gösteriliyor...',
        'prompt.input': 'Sen',
        'prompt.multiline': 'Çok satırlı mod (göndermek için Ctrl+D, iptal için Ctrl+C)',
        'usage.tokens': 'Jetonlar: {input} giriş / {output} çıkış',
        'usage.cost': 'Maliyet: ${cost}',
        'usage.model': 'Model: {model}',
        'i18n.current': 'Geçerli dil: {locale}',
        'i18n.switched': 'Dil {locale} olarak değiştirildi',
        'i18n.available': 'Kullanılabilir diller: {locales}',
        'vim.enabled': 'Vim modu etkin. Normal moda geçmek için Esc tuşuna basın.',
        'vim.disabled': 'Vim modu devre dışı.',
        'vim.mode.normal': 'NORMAL',
        'vim.mode.insert': 'EKLE',
        'vim.mode.visual': 'GÖRSEL',
        'vim.mode.command': 'KMD',
        'voice.enabled': 'Ses G/Ç etkin.',
        'voice.disabled': 'Ses G/Ç devre dışı.',
        'telemetry.enabled': 'Telemetri etkin. KVK verisi toplanmıyor.',
        'telemetry.disabled': 'Telemetri devre dışı.',
        'goodbye': 'Hoşça kalın! İyi kodlamalar!',
    },
    zh: {
        'app.name': 'NeuroCLI',
        'app.tagline': 'AI驱动的终端编程助手',
        'app.version': 'v{version}',
        'mode.auto': '自动模式（智能编排）',
        'mode.agent': '代理模式',
        'mode.direct': '直接模式',
        'mode.plan': '计划模式（只读）',
        'mode.yolo': 'YOLO模式（自动批准所有）',
        'cmd.help': '显示帮助信息',
        'cmd.model': '切换或列出模型',
        'cmd.agent': '切换或列出代理',
        'cmd.theme': '切换UI主题',
        'cmd.exit': '退出NeuroCLI',
        'cmd.clear': '清除终端',
        'cmd.stats': '显示会话统计',
        'cmd.undo': '撤销上次更改',
        'cmd.redo': '重做已撤销的更改',
        'cmd.sandbox': '切换沙箱模式',
        'cmd.style': '切换输出样式',
        'cmd.thinking': '切换思考模式',
        'cmd.skills': '管理技能',
        'cmd.cache': '管理提示缓存',
        'cmd.spending': '显示消费报告',
        'cmd.lang': '切换语言',
        'cmd.vim': '切换Vim模式',
        'cmd.voice': '切换语音输入输出',
        'cmd.telemetry': '管理遥测',
        'cmd.sync': '云同步',
        'cmd.server': 'API服务器',
        'cmd.dashboard': 'Web仪表板',
        'status.ready': '就绪',
        'status.processing': '处理中...',
        'status.thinking': '思考中...',
        'status.streaming': '流式响应中...',
        'status.done': '完成',
        'status.error': '错误',
        'status.cancelled': '已取消',
        'status.approved': '已批准',
        'status.denied': '已拒绝',
        'status.saved': '已保存',
        'status.loaded': '已加载',
        'warn.sandbox.denied': '沙箱：{target}的{action}被拒绝',
        'warn.spend.limit': '已达到消费限额（{limit}）',
        'warn.doom.loop': '检测到死循环：{reason}',
        'warn.ignoring': '已忽略：{path}在.neuroignore中',
        'info.model.switch': '已切换到{model}',
        'info.model.router': '模型路由：{complexity}任务 -> {model}',
        'info.cache.hit': '缓存命中 - 使用缓存响应',
        'info.skill.activated': '技能已激活：{name}（{trigger}）',
        'info.mcp.connected': 'MCP：{count}个服务器已连接',
        'info.plugins.loaded': '插件：{count}个已加载',
        'info.session.created': '新会话已创建',
        'info.session.resumed': '会话已恢复',
        'info.session.saved': '会话已保存',
        'info.session.exported': '会话已导出到{path}',
        'error.api.key': '未找到API密钥。请设置OPENROUTER_API_KEY环境变量。',
        'error.api.request': 'API请求失败：{message}',
        'error.api.timeout': 'API请求超时',
        'error.model.not_found': '未找到模型：{model}',
        'error.agent.not_found': '未找到代理：{agent}',
        'error.tool.not_found': '未找到工具：{tool}',
        'error.session.not_found': '未找到会话：{id}',
        'error.file.not_found': '未找到文件：{path}',
        'error.file.read': '无法读取文件：{path}',
        'error.file.write': '无法写入文件：{path}',
        'approval.request': '批准{tool}调用？（风险：{risk}）',
        'approval.auto_approved': '自动批准：{tool}',
        'approval.show_diff': '正在显示差异预览...',
        'prompt.input': '你',
        'prompt.multiline': '多行模式（Ctrl+D提交，Ctrl+C取消）',
        'usage.tokens': '令牌：{input}入 / {output}出',
        'usage.cost': '费用：${cost}',
        'usage.model': '模型：{model}',
        'i18n.current': '当前语言：{locale}',
        'i18n.switched': '语言已切换为{locale}',
        'i18n.available': '可用语言：{locales}',
        'vim.enabled': 'Vim模式已启用。按Esc进入普通模式。',
        'vim.disabled': 'Vim模式已禁用。',
        'vim.mode.normal': '普通',
        'vim.mode.insert': '插入',
        'vim.mode.visual': '可视',
        'vim.mode.command': '命令',
        'voice.enabled': '语音输入输出已启用。',
        'voice.disabled': '语音输入输出已禁用。',
        'telemetry.enabled': '遥测已启用。不收集个人身份信息。',
        'telemetry.disabled': '遥测已禁用。',
        'goodbye': '再见！编码愉快！',
    },
    ja: {
        'app.name': 'NeuroCLI',
        'app.tagline': 'AI搭載ターミナルコーディングアシスタント',
        'app.version': 'v{version}',
        'mode.auto': '自動モード（スマートオーケストレーション）',
        'mode.agent': 'エージェントモード',
        'mode.direct': 'ダイレクトモード',
        'mode.plan': '計画モード（読み取り専用）',
        'mode.yolo': 'YOLOモード（全自動承認）',
        'cmd.help': 'ヘルプメッセージを表示',
        'cmd.model': 'モデルを切り替えまたは一覧表示',
        'cmd.agent': 'エージェントを切り替えまたは一覧表示',
        'cmd.theme': 'UIテーマを切り替え',
        'cmd.exit': 'NeuroCLIを終了',
        'cmd.clear': 'ターミナルをクリア',
        'cmd.stats': 'セッション統計を表示',
        'cmd.undo': '最後の変更を元に戻す',
        'cmd.redo': 'やり直し',
        'cmd.sandbox': 'サンドボックスモードを切り替え',
        'cmd.style': '出力スタイルを切り替え',
        'cmd.thinking': '思考モードを切り替え',
        'cmd.skills': 'スキルを管理',
        'cmd.cache': 'プロンプトキャッシュを管理',
        'cmd.spending': '支出レポートを表示',
        'cmd.lang': '言語を切り替え',
        'cmd.vim': 'Vimモードを切り替え',
        'cmd.voice': '音声I/Oを切り替え',
        'cmd.telemetry': 'テレメトリを管理',
        'cmd.sync': 'クラウド同期',
        'cmd.server': 'APIサーバー',
        'cmd.dashboard': 'Webダッシュボード',
        'status.ready': '準備完了',
        'status.processing': '処理中...',
        'status.thinking': '思考中...',
        'status.streaming': 'ストリーミング応答中...',
        'status.done': '完了',
        'status.error': 'エラー',
        'status.cancelled': 'キャンセル',
        'status.approved': '承認済み',
        'status.denied': '拒否',
        'status.saved': '保存済み',
        'status.loaded': '読み込み済み',
        'warn.sandbox.denied': 'サンドボックス：{target}の{action}が拒否されました',
        'warn.spend.limit': '支出限度額に達しました（{limit}）',
        'warn.doom.loop': 'デスループが検出されました：{reason}',
        'warn.ignoring': '無視：{path}は.neuroignoreにあります',
        'info.model.switch': '{model}に切り替えました',
        'info.model.router': 'モデルルーター：{complexity}タスク -> {model}',
        'info.cache.hit': 'キャッシュヒット - キャッシュされた応答を使用',
        'info.skill.activated': 'スキルがアクティブ化：{name}（{trigger}）',
        'info.mcp.connected': 'MCP：{count}台のサーバーが接続されました',
        'info.plugins.loaded': 'プラグイン：{count}個がロードされました',
        'info.session.created': '新しいセッションが作成されました',
        'info.session.resumed': 'セッションが再開されました',
        'info.session.saved': 'セッションが保存されました',
        'info.session.exported': 'セッションが{path}にエクスポートされました',
        'error.api.key': 'APIキーが見つかりません。OPENROUTER_API_KEY環境変数を設定してください。',
        'error.api.request': 'APIリクエストが失敗しました：{message}',
        'error.api.timeout': 'APIリクエストがタイムアウトしました',
        'error.model.not_found': 'モデルが見つかりません：{model}',
        'error.agent.not_found': 'エージェントが見つかりません：{agent}',
        'error.tool.not_found': 'ツールが見つかりません：{tool}',
        'error.session.not_found': 'セッションが見つかりません：{id}',
        'error.file.not_found': 'ファイルが見つかりません：{path}',
        'error.file.read': 'ファイルの読み取りに失敗しました：{path}',
        'error.file.write': 'ファイルの書き込みに失敗しました：{path}',
        'approval.request': '{tool}の呼び出しを承認しますか？（リスク：{risk}）',
        'approval.auto_approved': '自動承認：{tool}',
        'approval.show_diff': '差分プレビューを表示中...',
        'prompt.input': 'あなた',
        'prompt.multiline': '複数行モード（Ctrl+Dで送信、Ctrl+Cでキャンセル）',
        'usage.tokens': 'トークン：{input}入力 / {output}出力',
        'usage.cost': 'コスト：${cost}',
        'usage.model': 'モデル：{model}',
        'i18n.current': '現在の言語：{locale}',
        'i18n.switched': '言語が{locale}に切り替えられました',
        'i18n.available': '利用可能な言語：{locales}',
        'vim.enabled': 'Vimモードが有効です。Escでノーマルモードに入ります。',
        'vim.disabled': 'Vimモードが無効です。',
        'vim.mode.normal': 'ノーマル',
        'vim.mode.insert': '挿入',
        'vim.mode.visual': 'ビジュアル',
        'vim.mode.command': 'コマンド',
        'voice.enabled': '音声I/Oが有効です。',
        'voice.disabled': '音声I/Oが無効です。',
        'telemetry.enabled': 'テレメトリが有効です。個人情報は収集されません。',
        'telemetry.disabled': 'テレメトリが無効です。',
        'goodbye': 'さようなら！楽しいコーディングを！',
    },
    es: {
        'app.name': 'NeuroCLI',
        'app.tagline': 'Asistente de Codificación Terminal con IA',
        'app.version': 'v{version}',
        'mode.auto': 'Modo automático (orquestación inteligente)',
        'mode.agent': 'Modo agente',
        'mode.direct': 'Modo directo',
        'mode.plan': 'Modo plan (solo lectura)',
        'mode.yolo': 'Modo YOLO (auto-aprobar todo)',
        'cmd.help': 'Mostrar mensaje de ayuda',
        'cmd.model': 'Cambiar o listar modelos',
        'cmd.agent': 'Cambiar o listar agentes',
        'cmd.theme': 'Cambiar tema de UI',
        'cmd.exit': 'Salir de NeuroCLI',
        'cmd.clear': 'Limpiar terminal',
        'cmd.stats': 'Mostrar estadísticas de sesión',
        'cmd.undo': 'Deshacer último cambio',
        'cmd.redo': 'Rehacer cambio deshecho',
        'cmd.sandbox': 'Alternar modo sandbox',
        'cmd.style': 'Cambiar estilo de salida',
        'cmd.thinking': 'Alternar modo de pensamiento',
        'cmd.skills': 'Gestionar habilidades',
        'cmd.cache': 'Gestionar caché de prompts',
        'cmd.spending': 'Mostrar informe de gastos',
        'cmd.lang': 'Cambiar idioma',
        'cmd.vim': 'Alternar modo vim',
        'cmd.voice': 'Alternar entrada/salida de voz',
        'cmd.telemetry': 'Gestionar telemetría',
        'cmd.sync': 'Sincronización en la nube',
        'cmd.server': 'Servidor API',
        'cmd.dashboard': 'Panel web',
        'status.ready': 'Listo',
        'status.processing': 'Procesando...',
        'status.thinking': 'Pensando...',
        'status.streaming': 'Transmitiendo respuesta...',
        'status.done': 'Hecho',
        'status.error': 'Error',
        'status.cancelled': 'Cancelado',
        'status.approved': 'Aprobado',
        'status.denied': 'Denegado',
        'status.saved': 'Guardado',
        'status.loaded': 'Cargado',
        'warn.sandbox.denied': 'Sandbox: {action} denegada para {target}',
        'warn.spend.limit': 'Límite de gasto alcanzado ({limit})',
        'warn.doom.loop': 'Bucle de muerte detectado: {reason}',
        'warn.ignoring': 'Ignorado: {path} está en .neuroignore',
        'info.model.switch': 'Cambiado a {model}',
        'info.model.router': 'Enrutador de modelo: tarea {complexity} -> {model}',
        'info.cache.hit': 'Acierto de caché - usando respuesta en caché',
        'info.skill.activated': 'Habilidad activada: {name} ({trigger})',
        'info.mcp.connected': 'MCP: {count} servidor(es) conectado(s)',
        'info.plugins.loaded': 'Plugins: {count} cargado(s)',
        'info.session.created': 'Nueva sesión creada',
        'info.session.resumed': 'Sesión reanudada',
        'info.session.saved': 'Sesión guardada',
        'info.session.exported': 'Sesión exportada a {path}',
        'error.api.key': 'Clave API no encontrada. Establezca la variable de entorno OPENROUTER_API_KEY.',
        'error.api.request': 'Solicitud API fallida: {message}',
        'error.api.timeout': 'Solicitud API agotada',
        'error.model.not_found': 'Modelo no encontrado: {model}',
        'error.agent.not_found': 'Agente no encontrado: {agent}',
        'error.tool.not_found': 'Herramienta no encontrada: {tool}',
        'error.session.not_found': 'Sesión no encontrada: {id}',
        'error.file.not_found': 'Archivo no encontrado: {path}',
        'error.file.read': 'Error al leer archivo: {path}',
        'error.file.write': 'Error al escribir archivo: {path}',
        'approval.request': '¿Aprobar llamada {tool}? (riesgo: {risk})',
        'approval.auto_approved': 'Auto-aprobado: {tool}',
        'approval.show_diff': 'Mostrando vista previa de diferencias...',
        'prompt.input': 'Tú',
        'prompt.multiline': 'Modo multilínea (Ctrl+D para enviar, Ctrl+C para cancelar)',
        'usage.tokens': 'Tokens: {input} entrada / {output} salida',
        'usage.cost': 'Costo: ${cost}',
        'usage.model': 'Modelo: {model}',
        'i18n.current': 'Idioma actual: {locale}',
        'i18n.switched': 'Idioma cambiado a {locale}',
        'i18n.available': 'Idiomas disponibles: {locales}',
        'vim.enabled': 'Modo vim activado. Presione Esc para entrar en modo normal.',
        'vim.disabled': 'Modo vim desactivado.',
        'vim.mode.normal': 'NORMAL',
        'vim.mode.insert': 'INSERCIÓN',
        'vim.mode.visual': 'VISUAL',
        'vim.mode.command': 'CMD',
        'voice.enabled': 'Entrada/salida de voz activada.',
        'voice.disabled': 'Entrada/salida de voz desactivada.',
        'telemetry.enabled': 'Telemetría activada. No se recopila PII.',
        'telemetry.disabled': 'Telemetría desactivada.',
        'goodbye': '¡Adiós! ¡Feliz codificación!',
    },
};
// -----------------------------------------------------------
// Locale display names
// -----------------------------------------------------------
const LOCALE_NAMES = {
    en: 'English',
    tr: 'Türkçe',
    zh: '中文',
    ja: '日本語',
    es: 'Español',
};
// -----------------------------------------------------------
// I18n System
// -----------------------------------------------------------
const I18N_CONFIG_PATH = join(homedir(), '.neuro', 'i18n-config.json');
export class I18nSystem {
    config;
    customTranslations = new Map();
    constructor(config) {
        this.config = {
            locale: 'en',
            fallbackLocale: 'en',
            customTranslationsDir: join(homedir(), '.neuro', 'translations'),
            autoDetect: true,
            ...config,
        };
        this.loadConfig();
        if (this.config.autoDetect && this.config.locale === 'en') {
            this.autoDetectLocale();
        }
        this.loadCustomTranslations();
    }
    // ----------------------------------------------------------
    // Public API
    // ----------------------------------------------------------
    /**
     * Get a translated string by key
     */
    t(key, params) {
        let value = this.getTranslation(key);
        // Interpolate parameters
        if (params) {
            for (const [paramKey, paramValue] of Object.entries(params)) {
                value = value.replace(`{${paramKey}}`, String(paramValue));
            }
        }
        return value;
    }
    /**
     * Get current locale
     */
    getLocale() {
        return this.config.locale;
    }
    /**
     * Set locale
     */
    setLocale(locale) {
        if (!TRANSLATIONS[locale]) {
            console.log(chalk.red(`Unknown locale: ${locale}. Available: ${this.getAvailableLocales().join(', ')}`));
            return;
        }
        this.config.locale = locale;
        this.saveConfig();
        console.log(this.t('i18n.switched', { locale: LOCALE_NAMES[locale] }));
    }
    /**
     * Get all available locales
     */
    getAvailableLocales() {
        return Object.keys(TRANSLATIONS);
    }
    /**
     * Get locale display name
     */
    getLocaleName(locale) {
        return LOCALE_NAMES[locale] || locale;
    }
    /**
     * Get all locale names
     */
    getLocaleNames() {
        return { ...LOCALE_NAMES };
    }
    /**
     * Auto-detect system locale
     */
    autoDetectLocale() {
        const envLang = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANGUAGE || '';
        const detected = this.parseLocaleString(envLang);
        if (detected && TRANSLATIONS[detected]) {
            this.config.locale = detected;
            this.saveConfig();
        }
        return this.config.locale;
    }
    /**
     * Add a custom translation
     */
    addTranslation(locale, key, value) {
        let custom = this.customTranslations.get(locale);
        if (!custom) {
            custom = {};
            this.customTranslations.set(locale, custom);
        }
        custom[key] = value;
        this.saveCustomTranslations(locale);
    }
    /**
     * Remove a custom translation
     */
    removeTranslation(locale, key) {
        const custom = this.customTranslations.get(locale);
        if (!custom || !(key in custom))
            return false;
        delete custom[key];
        this.saveCustomTranslations(locale);
        return true;
    }
    /**
     * Get all translation keys for current locale
     */
    getAllKeys() {
        const keys = new Set();
        const base = TRANSLATIONS[this.config.locale] || TRANSLATIONS.en;
        for (const key of Object.keys(base)) {
            keys.add(key);
        }
        const custom = this.customTranslations.get(this.config.locale);
        if (custom) {
            for (const key of Object.keys(custom)) {
                keys.add(key);
            }
        }
        return Array.from(keys).sort();
    }
    /**
     * Export all translations for a locale as JSON
     */
    exportTranslations(locale) {
        const base = TRANSLATIONS[locale] || {};
        const custom = this.customTranslations.get(locale) || {};
        return JSON.stringify({ ...base, ...custom }, null, 2);
    }
    /**
     * Import translations from a JSON string
     */
    importTranslations(locale, json) {
        try {
            const parsed = JSON.parse(json);
            let count = 0;
            for (const [key, value] of Object.entries(parsed)) {
                this.addTranslation(locale, key, value);
                count++;
            }
            return count;
        }
        catch {
            console.log(chalk.red('Failed to parse translation JSON.'));
            return 0;
        }
    }
    /**
     * Print current locale info
     */
    printStatus() {
        console.log('');
        console.log(chalk.bold('--- NeuroCLI i18n ---'));
        console.log(`  ${this.t('i18n.current', { locale: this.getLocaleName(this.config.locale) })}`);
        console.log(`  ${this.t('i18n.available', { locales: this.getAvailableLocales().map(l => `${l} (${this.getLocaleName(l)})`).join(', ') })}`);
        console.log(`  Translation keys: ${this.getAllKeys().length}`);
        console.log('');
    }
    /**
     * Get config
     */
    getConfig() {
        return { ...this.config };
    }
    // ----------------------------------------------------------
    // Private helpers
    // ----------------------------------------------------------
    getTranslation(key) {
        // Check custom translations first
        const custom = this.customTranslations.get(this.config.locale);
        if (custom && custom[key])
            return custom[key];
        // Check built-in translations
        const localeTranslations = TRANSLATIONS[this.config.locale];
        if (localeTranslations && localeTranslations[key])
            return localeTranslations[key];
        // Fallback locale
        const customFallback = this.customTranslations.get(this.config.fallbackLocale);
        if (customFallback && customFallback[key])
            return customFallback[key];
        const fallbackTranslations = TRANSLATIONS[this.config.fallbackLocale];
        if (fallbackTranslations && fallbackTranslations[key])
            return fallbackTranslations[key];
        // Return key itself as last resort
        return key;
    }
    parseLocaleString(localeStr) {
        const lower = localeStr.toLowerCase();
        if (lower.startsWith('tr'))
            return 'tr';
        if (lower.startsWith('zh'))
            return 'zh';
        if (lower.startsWith('ja'))
            return 'ja';
        if (lower.startsWith('es'))
            return 'es';
        if (lower.startsWith('en'))
            return 'en';
        return null;
    }
    saveConfig() {
        try {
            const dir = join(I18N_CONFIG_PATH, '..');
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            writeFileSync(I18N_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
        }
        catch { /* Silently fail */ }
    }
    loadConfig() {
        try {
            if (existsSync(I18N_CONFIG_PATH)) {
                const raw = readFileSync(I18N_CONFIG_PATH, 'utf-8');
                const saved = JSON.parse(raw);
                this.config = { ...this.config, ...saved };
            }
        }
        catch { /* Silently fail */ }
    }
    loadCustomTranslations() {
        try {
            const dir = this.config.customTranslationsDir;
            if (!existsSync(dir))
                return;
            const files = readdirSync(dir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const locale = file.replace('.json', '');
                if (!TRANSLATIONS[locale])
                    continue;
                const raw = readFileSync(join(dir, file), 'utf-8');
                const translations = JSON.parse(raw);
                this.customTranslations.set(locale, translations);
            }
        }
        catch { /* Silently fail */ }
    }
    saveCustomTranslations(locale) {
        try {
            const dir = this.config.customTranslationsDir;
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            const custom = this.customTranslations.get(locale);
            if (custom) {
                writeFileSync(join(dir, `${locale}.json`), JSON.stringify(custom, null, 2), 'utf-8');
            }
        }
        catch { /* Silently fail */ }
    }
}
//# sourceMappingURL=i18n.js.map