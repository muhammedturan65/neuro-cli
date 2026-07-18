export interface VoiceConfig {
    /** Whether voice I/O is enabled */
    enabled: boolean;
    /** TTS engine to use */
    ttsEngine: 'system' | 'espeak' | 'say' | 'auto';
    /** STT engine to use */
    sttEngine: 'system' | 'whisper' | 'auto';
    /** TTS voice name */
    voiceName: string;
    /** TTS speech rate (words per minute or 0.5-2.0) */
    speechRate: number;
    /** TTS volume (0-100 or 0.0-1.0) */
    volume: number;
    /** TTS pitch adjustment */
    pitch: number;
    /** Language for TTS/STT */
    language: string;
    /** Whether to auto-speak assistant responses */
    autoSpeak: boolean;
    /** Whether to listen for voice commands continuously */
    continuousListening: boolean;
    /** Voice command prefix (e.g. "hey neuro") */
    wakeWord: string;
    /** STT silence timeout in ms */
    silenceTimeout: number;
}
export interface VoiceCommand {
    command: string;
    pattern: RegExp;
    handler: (match: RegExpMatchArray) => void;
    description: string;
}
export interface VoiceRecognitionResult {
    text: string;
    confidence: number;
    isCommand: boolean;
    commandName?: string;
}
export declare class VoiceIO {
    private config;
    private activeTTSProcess;
    private isSpeaking;
    private isListening;
    private voiceCommands;
    private ttsAvailable;
    private sttAvailable;
    private speechQueue;
    private onTranscript;
    constructor(config?: Partial<VoiceConfig>);
    /**
     * Check if voice I/O is enabled
     */
    isEnabled(): boolean;
    /**
     * Enable voice I/O
     */
    enable(): void;
    /**
     * Disable voice I/O
     */
    disable(): void;
    /**
     * Toggle voice I/O
     */
    toggle(): boolean;
    /**
     * Speak text using TTS
     */
    speak(text: string): Promise<boolean>;
    /**
     * Speak text asynchronously (queue it)
     */
    speakAsync(text: string): void;
    /**
     * Stop current TTS
     */
    stopSpeaking(): void;
    /**
     * Check if currently speaking
     */
    getIsSpeaking(): boolean;
    /**
     * Start listening for voice input
     */
    startListening(callback: (text: string) => void): Promise<boolean>;
    /**
     * Stop listening for voice input
     */
    stopListening(): void;
    /**
     * Check if currently listening
     */
    getIsListening(): boolean;
    /**
     * Process a voice transcript for commands
     */
    processVoiceInput(text: string): VoiceRecognitionResult;
    /**
     * Register a voice command
     */
    registerCommand(command: VoiceCommand): void;
    /**
     * List registered voice commands
     */
    listCommands(): VoiceCommand[];
    /**
     * Set TTS engine
     */
    setTTSEngine(engine: VoiceConfig['ttsEngine']): void;
    /**
     * Set STT engine
     */
    setSTTEngine(engine: VoiceConfig['sttEngine']): void;
    /**
     * Set voice parameters
     */
    setVoice(params: Partial<Pick<VoiceConfig, 'voiceName' | 'speechRate' | 'volume' | 'pitch' | 'language'>>): void;
    /**
     * List available TTS voices
     */
    listVoices(): string[];
    /**
     * Get config
     */
    getConfig(): VoiceConfig;
    /**
     * Print voice status
     */
    printStatus(): void;
    private checkTTSAvailability;
    private checkSTTAvailability;
    private cleanTextForTTS;
    private registerDefaultCommands;
    private saveConfig;
    private loadConfig;
}
//# sourceMappingURL=voice.d.ts.map