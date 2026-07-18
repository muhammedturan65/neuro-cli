// ============================================================
// NeuroCLI - Image/Multimodal Support
// Base64 image encoding for API calls, image file detection,
// screenshot analysis, PNG/JPG/GIF/WebP support
// Integration with models that support vision
// ============================================================
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname, basename } from 'path';
import chalk from 'chalk';
// -----------------------------------------------------------
// Constants
// -----------------------------------------------------------
const FORMAT_MIME_MAP = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
};
const EXT_FORMAT_MAP = {
    '.png': 'png',
    '.jpg': 'jpeg',
    '.jpeg': 'jpeg',
    '.gif': 'gif',
    '.webp': 'webp',
};
// Known vision-capable models
const VISION_MODELS = {
    'openai/gpt-4o': { modelId: 'openai/gpt-4o', supportsVision: true, maxImages: 10 },
    'openai/gpt-4o-mini': { modelId: 'openai/gpt-4o-mini', supportsVision: true, maxImages: 10 },
    'anthropic/claude-3.5-sonnet': { modelId: 'anthropic/claude-3.5-sonnet', supportsVision: true, maxImages: 20 },
    'google/gemini-pro-vision': { modelId: 'google/gemini-pro-vision', supportsVision: true, maxImages: 16 },
    'meta-llama/llama-3.2-11b-vision-instruct': { modelId: 'meta-llama/llama-3.2-11b-vision-instruct', supportsVision: true, maxImages: 5 },
};
const DEFAULT_CONFIG = {
    maxImageSize: 20 * 1024 * 1024, // 20MB
    supportedFormats: ['png', 'jpeg', 'gif', 'webp'],
    autoDetectImages: true,
    autoResize: true,
    maxDimension: 2048,
    jpegQuality: 85,
};
// -----------------------------------------------------------
// MultimodalSupport
// -----------------------------------------------------------
export class MultimodalSupport {
    config;
    loadedImages = new Map();
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    // ----------------------------------------------------------
    // Public API
    // ----------------------------------------------------------
    /**
     * Load an image from a file path and return base64 encoded content
     */
    loadImage(filePath) {
        const resolvedPath = this.resolvePath(filePath);
        if (!existsSync(resolvedPath)) {
            throw new Error(`Image file not found: ${resolvedPath}`);
        }
        const stat = statSync(resolvedPath);
        if (stat.size > this.config.maxImageSize) {
            throw new Error(`Image file too large: ${stat.size} bytes (max: ${this.config.maxImageSize} bytes)`);
        }
        const ext = extname(resolvedPath).toLowerCase();
        const format = EXT_FORMAT_MAP[ext];
        if (!format || !this.config.supportedFormats.includes(format)) {
            throw new Error(`Unsupported image format: ${ext}. Supported: ${this.config.supportedFormats.join(', ')}`);
        }
        const data = readFileSync(resolvedPath);
        const base64 = data.toString('base64');
        const mimeType = FORMAT_MIME_MAP[format];
        const content = {
            base64,
            mimeType,
            filePath: resolvedPath,
            size: stat.size,
            format,
        };
        // Cache the loaded image
        this.loadedImages.set(resolvedPath, content);
        return content;
    }
    /**
     * Load multiple images from file paths
     */
    loadImages(filePaths) {
        const results = [];
        for (const path of filePaths) {
            try {
                results.push(this.loadImage(path));
            }
            catch (error) {
                console.log(chalk.yellow(`Skipping image ${path}: ${error instanceof Error ? error.message : String(error)}`));
            }
        }
        return results;
    }
    /**
     * Build a multimodal message with text and images
     */
    buildMessage(text, images, detail = 'auto') {
        const parts = [];
        // Add text part
        if (text) {
            parts.push({ type: 'text', text });
        }
        // Add image parts
        for (const image of images) {
            const dataUrl = `data:${image.mimeType};base64,${image.base64}`;
            parts.push({
                type: 'image_url',
                image_url: { url: dataUrl, detail },
            });
        }
        return {
            role: 'user',
            content: parts,
        };
    }
    /**
     * Build a multimodal message from text and image file paths
     */
    buildMessageFromPaths(text, imagePaths, detail) {
        const images = this.loadImages(imagePaths);
        return this.buildMessage(text, images, detail);
    }
    /**
     * Detect image references in a text prompt
     * Supports: @image:path, ![alt](path), file paths ending in image extensions
     */
    detectImageReferences(text) {
        if (!this.config.autoDetectImages)
            return [];
        const paths = [];
        // Match @image:path syntax
        const imageRefRegex = /@image:([^\s]+)/g;
        let match;
        while ((match = imageRefRegex.exec(text)) !== null) {
            paths.push(match[1]);
        }
        // Match markdown image syntax ![alt](path)
        const mdImageRegex = /!\[.*?\]\(([^)]+)\)/g;
        while ((match = mdImageRegex.exec(text)) !== null) {
            paths.push(match[1]);
        }
        // Match file paths ending in image extensions
        const extPattern = this.config.supportedFormats
            .flatMap(f => {
            switch (f) {
                case 'jpeg': return ['.jpg', '.jpeg'];
                default: return [`.${f}`];
            }
        })
            .join('|');
        const pathRegex = new RegExp(`(?:^|\\s)([\\S]+(?:${extPattern}))(?:\\s|$)`, 'gi');
        while ((match = pathRegex.exec(text)) !== null) {
            const potentialPath = match[1];
            // Only include if it looks like a file path (starts with ./, /, ~, or contains path separators)
            if (potentialPath.startsWith('./') || potentialPath.startsWith('/') || potentialPath.startsWith('~') || potentialPath.includes('/')) {
                paths.push(potentialPath);
            }
        }
        return [...new Set(paths)];
    }
    /**
     * Process a user prompt that may contain image references
     * Returns the cleaned text and loaded images
     */
    processPrompt(text) {
        const imagePaths = this.detectImageReferences(text);
        const images = [];
        let cleanedText = text;
        for (const path of imagePaths) {
            try {
                const image = this.loadImage(path);
                images.push(image);
                // Remove image reference syntax from text
                cleanedText = cleanedText.replace(`@image:${path}`, `[image: ${basename(path)}]`);
                cleanedText = cleanedText.replace(new RegExp(`!\\[.*?\\]\\(${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'), `[image: ${basename(path)}]`);
            }
            catch (error) {
                console.log(chalk.yellow(`Could not load image ${path}: ${error instanceof Error ? error.message : String(error)}`));
            }
        }
        return { text: cleanedText.trim(), images };
    }
    /**
     * Check if a model supports vision
     */
    isVisionModel(modelId) {
        // Check known vision models
        if (VISION_MODELS[modelId])
            return VISION_MODELS[modelId].supportsVision;
        // Check by model name patterns
        const lower = modelId.toLowerCase();
        return (lower.includes('vision') ||
            lower.includes('gpt-4o') ||
            lower.includes('claude-3') ||
            lower.includes('gemini') ||
            lower.includes('llama-3.2') ||
            lower.includes('qwen-vl') ||
            lower.includes('cogvlm') ||
            lower.includes('llava'));
    }
    /**
     * Get vision model info
     */
    getVisionModelInfo(modelId) {
        if (VISION_MODELS[modelId])
            return VISION_MODELS[modelId];
        if (this.isVisionModel(modelId)) {
            return { modelId, supportsVision: true, maxImages: 10 };
        }
        return null;
    }
    /**
     * Check if a file is a supported image
     */
    isImageFile(filePath) {
        const ext = extname(filePath).toLowerCase();
        const format = EXT_FORMAT_MAP[ext];
        return format !== undefined && this.config.supportedFormats.includes(format);
    }
    /**
     * Get the format of an image file
     */
    getImageFormat(filePath) {
        const ext = extname(filePath).toLowerCase();
        return EXT_FORMAT_MAP[ext] || null;
    }
    /**
     * Get base64 data URL for an image
     */
    getDataUrl(image) {
        return `data:${image.mimeType};base64,${image.base64}`;
    }
    /**
     * Get all loaded images
     */
    getLoadedImages() {
        return Array.from(this.loadedImages.values());
    }
    /**
     * Clear the image cache
     */
    clearCache() {
        this.loadedImages.clear();
    }
    /**
     * Get supported formats
     */
    getSupportedFormats() {
        return [...this.config.supportedFormats];
    }
    /**
     * Get config
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Print multimodal status
     */
    printStatus() {
        console.log('');
        console.log(chalk.bold('--- NeuroCLI Multimodal Support ---'));
        console.log(`  Supported formats: ${chalk.cyan(this.config.supportedFormats.join(', '))}`);
        console.log(`  Max image size: ${chalk.yellow(`${(this.config.maxImageSize / 1024 / 1024).toFixed(1)}MB`)}`);
        console.log(`  Auto-detect: ${this.config.autoDetectImages ? chalk.green('enabled') : chalk.gray('disabled')}`);
        console.log(`  Loaded images: ${this.loadedImages.size}`);
        console.log('');
    }
    // ----------------------------------------------------------
    // Private helpers
    // ----------------------------------------------------------
    resolvePath(filePath) {
        if (filePath.startsWith('/'))
            return filePath;
        if (filePath.startsWith('~/'))
            return join(require('os').homedir(), filePath.slice(2));
        return join(process.cwd(), filePath);
    }
}
//# sourceMappingURL=multimodal.js.map