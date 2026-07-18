export type SupportedLocale = 'en' | 'tr' | 'zh' | 'ja' | 'es';
export interface I18nConfig {
    /** Current locale */
    locale: SupportedLocale;
    /** Fallback locale when a key is missing */
    fallbackLocale: SupportedLocale;
    /** Directory for custom translation files */
    customTranslationsDir: string;
    /** Whether to auto-detect system language on first run */
    autoDetect: boolean;
}
export interface TranslationEntry {
    key: string;
    value: string;
}
export declare class I18nSystem {
    private config;
    private customTranslations;
    constructor(config?: Partial<I18nConfig>);
    /**
     * Get a translated string by key
     */
    t(key: string, params?: Record<string, string | number>): string;
    /**
     * Get current locale
     */
    getLocale(): SupportedLocale;
    /**
     * Set locale
     */
    setLocale(locale: SupportedLocale): void;
    /**
     * Get all available locales
     */
    getAvailableLocales(): SupportedLocale[];
    /**
     * Get locale display name
     */
    getLocaleName(locale: SupportedLocale): string;
    /**
     * Get all locale names
     */
    getLocaleNames(): Record<SupportedLocale, string>;
    /**
     * Auto-detect system locale
     */
    autoDetectLocale(): SupportedLocale;
    /**
     * Add a custom translation
     */
    addTranslation(locale: SupportedLocale, key: string, value: string): void;
    /**
     * Remove a custom translation
     */
    removeTranslation(locale: SupportedLocale, key: string): boolean;
    /**
     * Get all translation keys for current locale
     */
    getAllKeys(): string[];
    /**
     * Export all translations for a locale as JSON
     */
    exportTranslations(locale: SupportedLocale): string;
    /**
     * Import translations from a JSON string
     */
    importTranslations(locale: SupportedLocale, json: string): number;
    /**
     * Print current locale info
     */
    printStatus(): void;
    /**
     * Get config
     */
    getConfig(): I18nConfig;
    private getTranslation;
    private parseLocaleString;
    private saveConfig;
    private loadConfig;
    private loadCustomTranslations;
    private saveCustomTranslations;
}
//# sourceMappingURL=i18n.d.ts.map