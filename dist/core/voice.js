// ============================================================
// NeuroCLI - Voice I/O System
// Text-to-speech output, speech-to-text input,
// voice command recognition, /voice on/off
// Configurable voice settings
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync, spawn } from 'child_process';
import chalk from 'chalk';
// -----------------------------------------------------------
// Default config
// -----------------------------------------------------------
const VOICE_CONFIG_PATH = join(homedir(), '.neuro', 'voice-config.json');
function detectTTSEngine() {
    // macOS has 'say' built in
    if (process.platform === 'darwin')
        return 'say';
    // Check for espeak on Linux
    try {
        execSync('which espeak', { stdio: 'ignore' });
        return 'espeak';
    }
    catch { /* not found */ }
    try {
        execSync('which espeak-ng', { stdio: 'ignore' });
        return 'espeak';
    }
    catch { /* not found */ }
    return 'system';
}
function detectSTTEngine() {
    try {
        execSync('which whisper', { stdio: 'ignore' });
        return 'whisper';
    }
    catch { /* not found */ }
    return 'system';
}
function defaultConfig() {
    return {
        enabled: false,
        ttsEngine: 'auto',
        sttEngine: 'auto',
        voiceName: '',
        speechRate: 1.0,
        volume: 0.8,
        pitch: 1.0,
        language: 'en',
        autoSpeak: false,
        continuousListening: false,
        wakeWord: 'hey neuro',
        silenceTimeout: 3000,
    };
}
// -----------------------------------------------------------
// VoiceIO
// -----------------------------------------------------------
export class VoiceIO {
    config;
    activeTTSProcess = null;
    isSpeaking = false;
    isListening = false;
    voiceCommands = [];
    ttsAvailable = false;
    sttAvailable = false;
    speechQueue = [];
    onTranscript = null;
    constructor(config) {
        this.config = { ...defaultConfig(), ...config };
        this.loadConfig();
        // Auto-detect engines
        if (this.config.ttsEngine === 'auto') {
            this.config.ttsEngine = detectTTSEngine();
        }
        if (this.config.sttEngine === 'auto') {
            this.config.sttEngine = detectSTTEngine();
        }
        // Check availability
        this.checkTTSAvailability();
        this.checkSTTAvailability();
        // Register default voice commands
        this.registerDefaultCommands();
    }
    // ----------------------------------------------------------
    // Public API
    // ----------------------------------------------------------
    /**
     * Check if voice I/O is enabled
     */
    isEnabled() {
        return this.config.enabled;
    }
    /**
     * Enable voice I/O
     */
    enable() {
        if (!this.ttsAvailable && !this.sttAvailable) {
            console.log(chalk.yellow('No TTS/STT engines found. Install espeak or use macOS for TTS, or whisper for STT.'));
            console.log(chalk.gray('Voice I/O enabled in limited mode (will use system APIs if available).'));
        }
        this.config.enabled = true;
        this.saveConfig();
        console.log(chalk.green('Voice I/O enabled.'));
    }
    /**
     * Disable voice I/O
     */
    disable() {
        this.stopSpeaking();
        this.stopListening();
        this.config.enabled = false;
        this.saveConfig();
        console.log(chalk.gray('Voice I/O disabled.'));
    }
    /**
     * Toggle voice I/O
     */
    toggle() {
        if (this.config.enabled)
            this.disable();
        else
            this.enable();
        return this.config.enabled;
    }
    /**
     * Speak text using TTS
     */
    async speak(text) {
        if (!this.config.enabled || !this.ttsAvailable)
            return false;
        // Clean text for TTS (remove markdown, code blocks, etc.)
        const cleanText = this.cleanTextForTTS(text);
        if (!cleanText.trim())
            return false;
        return new Promise((resolve) => {
            try {
                let command;
                let args;
                switch (this.config.ttsEngine) {
                    case 'say': // macOS
                        command = 'say';
                        args = [];
                        if (this.config.voiceName)
                            args.push('-v', this.config.voiceName);
                        if (this.config.speechRate !== 1.0)
                            args.push('-r', String(Math.round(this.config.speechRate * 200)));
                        args.push(cleanText);
                        break;
                    case 'espeak':
                        command = 'espeak';
                        args = [];
                        if (this.config.voiceName)
                            args.push('-v', this.config.voiceName);
                        if (this.config.speechRate > 0)
                            args.push('-s', String(Math.round(this.config.speechRate * 175)));
                        if (this.config.pitch !== 1.0)
                            args.push('-p', String(Math.round(this.config.pitch * 50)));
                        if (this.config.volume < 1.0)
                            args.push('-a', String(Math.round(this.config.volume * 100)));
                        args.push(cleanText);
                        break;
                    default:
                        // Try system default
                        if (process.platform === 'darwin') {
                            command = 'say';
                            args = [cleanText];
                        }
                        else {
                            resolve(false);
                            return;
                        }
                }
                this.isSpeaking = true;
                const proc = spawn(command, args, { stdio: 'ignore' });
                this.activeTTSProcess = proc;
                proc.on('close', () => {
                    this.isSpeaking = false;
                    this.activeTTSProcess = null;
                    // Process queue
                    if (this.speechQueue.length > 0) {
                        const next = this.speechQueue.shift();
                        this.speak(next).then(resolve);
                    }
                    else {
                        resolve(true);
                    }
                });
                proc.on('error', () => {
                    this.isSpeaking = false;
                    this.activeTTSProcess = null;
                    resolve(false);
                });
            }
            catch {
                resolve(false);
            }
        });
    }
    /**
     * Speak text asynchronously (queue it)
     */
    speakAsync(text) {
        if (!this.config.enabled)
            return;
        if (this.isSpeaking) {
            this.speechQueue.push(text);
        }
        else {
            this.speak(text).catch(() => { });
        }
    }
    /**
     * Stop current TTS
     */
    stopSpeaking() {
        if (this.activeTTSProcess) {
            try {
                this.activeTTSProcess.kill();
            }
            catch { /* ignore */ }
            this.activeTTSProcess = null;
        }
        this.isSpeaking = false;
        this.speechQueue = [];
    }
    /**
     * Check if currently speaking
     */
    getIsSpeaking() {
        return this.isSpeaking;
    }
    /**
     * Start listening for voice input
     */
    async startListening(callback) {
        if (!this.config.enabled || !this.sttAvailable)
            return false;
        this.onTranscript = callback;
        this.isListening = true;
        console.log(chalk.cyan('Listening... (speak now)'));
        try {
            switch (this.config.sttEngine) {
                case 'whisper': {
                    // Use whisper CLI to record and transcribe
                    const proc = spawn('whisper', [
                        '--model', 'base',
                        '--language', this.config.language,
                        '--output_format', 'txt',
                        '--output_dir', '-',
                    ], { stdio: ['pipe', 'pipe', 'pipe'] });
                    let transcript = '';
                    proc.stdout.on('data', (data) => {
                        transcript += data.toString();
                    });
                    proc.on('close', () => {
                        this.isListening = false;
                        if (transcript.trim() && this.onTranscript) {
                            this.onTranscript(transcript.trim());
                        }
                    });
                    return true;
                }
                default: {
                    // System API fallback - use arecord + whisper or similar
                    console.log(chalk.yellow('System STT not fully supported. Consider installing whisper CLI.'));
                    this.isListening = false;
                    return false;
                }
            }
        }
        catch {
            this.isListening = false;
            return false;
        }
    }
    /**
     * Stop listening for voice input
     */
    stopListening() {
        this.isListening = false;
        this.onTranscript = null;
    }
    /**
     * Check if currently listening
     */
    getIsListening() {
        return this.isListening;
    }
    /**
     * Process a voice transcript for commands
     */
    processVoiceInput(text) {
        const lower = text.toLowerCase().trim();
        // Check for wake word
        if (this.config.wakeWord && !lower.startsWith(this.config.wakeWord.toLowerCase())) {
            return {
                text,
                confidence: 1.0,
                isCommand: false,
            };
        }
        // Remove wake word
        const commandText = this.config.wakeWord
            ? lower.replace(this.config.wakeWord.toLowerCase(), '').trim()
            : lower;
        // Check voice commands
        for (const cmd of this.voiceCommands) {
            const match = commandText.match(cmd.pattern);
            if (match) {
                cmd.handler(match);
                return {
                    text,
                    confidence: 1.0,
                    isCommand: true,
                    commandName: cmd.command,
                };
            }
        }
        return {
            text,
            confidence: 1.0,
            isCommand: false,
        };
    }
    /**
     * Register a voice command
     */
    registerCommand(command) {
        this.voiceCommands.push(command);
    }
    /**
     * List registered voice commands
     */
    listCommands() {
        return [...this.voiceCommands];
    }
    /**
     * Set TTS engine
     */
    setTTSEngine(engine) {
        this.config.ttsEngine = engine;
        this.checkTTSAvailability();
        this.saveConfig();
    }
    /**
     * Set STT engine
     */
    setSTTEngine(engine) {
        this.config.sttEngine = engine;
        this.checkSTTAvailability();
        this.saveConfig();
    }
    /**
     * Set voice parameters
     */
    setVoice(params) {
        if (params.voiceName !== undefined)
            this.config.voiceName = params.voiceName;
        if (params.speechRate !== undefined)
            this.config.speechRate = params.speechRate;
        if (params.volume !== undefined)
            this.config.volume = params.volume;
        if (params.pitch !== undefined)
            this.config.pitch = params.pitch;
        if (params.language !== undefined)
            this.config.language = params.language;
        this.saveConfig();
    }
    /**
     * List available TTS voices
     */
    listVoices() {
        try {
            switch (this.config.ttsEngine) {
                case 'say': {
                    const output = execSync('say -v "?"', { encoding: 'utf-8' });
                    return output.split('\n').filter(l => l.trim()).map(l => l.split(/\s+/)[0]).filter(Boolean);
                }
                case 'espeak': {
                    const output = execSync('espeak --voices', { encoding: 'utf-8' });
                    return output.split('\n').slice(1).filter(l => l.trim()).map(l => {
                        const parts = l.trim().split(/\s+/);
                        return parts.length >= 4 ? parts[3] : '';
                    }).filter(Boolean);
                }
                default:
                    return [];
            }
        }
        catch {
            return [];
        }
    }
    /**
     * Get config
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Print voice status
     */
    printStatus() {
        console.log('');
        console.log(chalk.bold('--- NeuroCLI Voice I/O ---'));
        console.log(`  Enabled: ${this.config.enabled ? chalk.green('yes') : chalk.gray('no')}`);
        console.log(`  TTS Engine: ${chalk.cyan(this.config.ttsEngine)} ${this.ttsAvailable ? chalk.green('(available)') : chalk.red('(unavailable)')}`);
        console.log(`  STT Engine: ${chalk.cyan(this.config.sttEngine)} ${this.sttAvailable ? chalk.green('(available)') : chalk.red('(unavailable)')}`);
        console.log(`  Voice: ${this.config.voiceName || chalk.gray('(default)')}`);
        console.log(`  Rate: ${this.config.speechRate}`);
        console.log(`  Language: ${this.config.language}`);
        console.log(`  Auto-speak: ${this.config.autoSpeak ? chalk.green('on') : chalk.gray('off')}`);
        console.log(`  Wake word: ${this.config.wakeWord || chalk.gray('(none)')}`);
        console.log(`  Voice commands: ${this.voiceCommands.length}`);
        if (this.isSpeaking)
            console.log(`  ${chalk.yellow('Currently speaking...')}`);
        if (this.isListening)
            console.log(`  ${chalk.cyan('Currently listening...')}`);
        console.log('');
    }
    // ----------------------------------------------------------
    // Private helpers
    // ----------------------------------------------------------
    checkTTSAvailability() {
        try {
            switch (this.config.ttsEngine) {
                case 'say':
                    execSync('which say', { stdio: 'ignore' });
                    this.ttsAvailable = true;
                    break;
                case 'espeak':
                    try {
                        execSync('which espeak', { stdio: 'ignore' });
                    }
                    catch {
                        execSync('which espeak-ng', { stdio: 'ignore' });
                    }
                    this.ttsAvailable = true;
                    break;
                default:
                    this.ttsAvailable = process.platform === 'darwin';
            }
        }
        catch {
            this.ttsAvailable = false;
        }
    }
    checkSTTAvailability() {
        try {
            if (this.config.sttEngine === 'whisper') {
                execSync('which whisper', { stdio: 'ignore' });
                this.sttAvailable = true;
            }
            else {
                this.sttAvailable = false;
            }
        }
        catch {
            this.sttAvailable = false;
        }
    }
    cleanTextForTTS(text) {
        return text
            // Remove code blocks
            .replace(/```[\s\S]*?```/g, ' code block ')
            // Remove inline code
            .replace(/`[^`]+`/g, ' code ')
            // Remove markdown formatting
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            .replace(/__([^_]+)__/g, '$1')
            .replace(/_([^_]+)_/g, '$1')
            .replace(/##?\s+/g, '')
            // Remove URLs
            .replace(/https?:\/\/\S+/g, ' link ')
            // Remove ANSI escape codes
            .replace(/\x1b\[[0-9;]*m/g, '')
            // Collapse whitespace
            .replace(/\s+/g, ' ')
            .trim();
    }
    registerDefaultCommands() {
        this.voiceCommands = [
            {
                command: 'exit',
                pattern: /^(exit|quit|bye)/,
                handler: () => console.log(chalk.yellow('Use /exit or Ctrl+C to quit.')),
                description: 'Exit NeuroCLI',
            },
            {
                command: 'model',
                pattern: /^(switch model|change model|use model)\s+(.+)/,
                handler: (match) => console.log(chalk.gray(`Model switch requested: ${match[2]}`)),
                description: 'Switch model',
            },
            {
                command: 'clear',
                pattern: /^(clear screen|clear)/,
                handler: () => console.clear(),
                description: 'Clear terminal',
            },
            {
                command: 'help',
                pattern: /^(help|commands)/,
                handler: () => console.log(chalk.gray('Voice commands: exit, model <name>, clear, help, stop')),
                description: 'Show help',
            },
            {
                command: 'stop',
                pattern: /^(stop|shut up|quiet|silence)/,
                handler: () => this.stopSpeaking(),
                description: 'Stop speaking',
            },
        ];
    }
    saveConfig() {
        try {
            const dir = join(VOICE_CONFIG_PATH, '..');
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            writeFileSync(VOICE_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
        }
        catch { /* Silently fail */ }
    }
    loadConfig() {
        try {
            if (existsSync(VOICE_CONFIG_PATH)) {
                const raw = readFileSync(VOICE_CONFIG_PATH, 'utf-8');
                const saved = JSON.parse(raw);
                this.config = { ...this.config, ...saved };
            }
        }
        catch { /* Silently fail */ }
    }
}
//# sourceMappingURL=voice.js.map