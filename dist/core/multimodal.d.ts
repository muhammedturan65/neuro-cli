export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp';
export interface MultimodalConfig {
    /** Max image file size in bytes (default: 20MB) */
    maxImageSize: number;
    /** Supported formats */
    supportedFormats: ImageFormat[];
    /** Whether to auto-detect images in prompts */
    autoDetectImages: boolean;
    /** Whether to resize large images */
    autoResize: boolean;
    /** Maximum dimension for resized images (default: 2048) */
    maxDimension: number;
    /** Image quality for JPEG compression (0-100) */
    jpegQuality: number;
}
export interface ImageContent {
    /** Base64 encoded image data */
    base64: string;
    /** MIME type */
    mimeType: string;
    /** Original file path */
    filePath: string;
    /** File size in bytes */
    size: number;
    /** Image dimensions if available */
    width?: number;
    height?: number;
    /** Format */
    format: ImageFormat;
}
export interface MultimodalMessage {
    role: 'user' | 'assistant';
    content: MultimodalContentPart[];
}
export type MultimodalContentPart = {
    type: 'text';
    text: string;
} | {
    type: 'image_url';
    image_url: {
        url: string;
        detail?: 'auto' | 'low' | 'high';
    };
};
export interface VisionModelInfo {
    modelId: string;
    supportsVision: boolean;
    maxImages: number;
}
export declare class MultimodalSupport {
    private config;
    private loadedImages;
    constructor(config?: Partial<MultimodalConfig>);
    /**
     * Load an image from a file path and return base64 encoded content
     */
    loadImage(filePath: string): ImageContent;
    /**
     * Load multiple images from file paths
     */
    loadImages(filePaths: string[]): ImageContent[];
    /**
     * Build a multimodal message with text and images
     */
    buildMessage(text: string, images: ImageContent[], detail?: 'auto' | 'low' | 'high'): MultimodalMessage;
    /**
     * Build a multimodal message from text and image file paths
     */
    buildMessageFromPaths(text: string, imagePaths: string[], detail?: 'auto' | 'low' | 'high'): MultimodalMessage;
    /**
     * Detect image references in a text prompt
     * Supports: @image:path, ![alt](path), file paths ending in image extensions
     */
    detectImageReferences(text: string): string[];
    /**
     * Process a user prompt that may contain image references
     * Returns the cleaned text and loaded images
     */
    processPrompt(text: string): {
        text: string;
        images: ImageContent[];
    };
    /**
     * Check if a model supports vision
     */
    isVisionModel(modelId: string): boolean;
    /**
     * Get vision model info
     */
    getVisionModelInfo(modelId: string): VisionModelInfo | null;
    /**
     * Check if a file is a supported image
     */
    isImageFile(filePath: string): boolean;
    /**
     * Get the format of an image file
     */
    getImageFormat(filePath: string): ImageFormat | null;
    /**
     * Get base64 data URL for an image
     */
    getDataUrl(image: ImageContent): string;
    /**
     * Get all loaded images
     */
    getLoadedImages(): ImageContent[];
    /**
     * Clear the image cache
     */
    clearCache(): void;
    /**
     * Get supported formats
     */
    getSupportedFormats(): ImageFormat[];
    /**
     * Get config
     */
    getConfig(): MultimodalConfig;
    /**
     * Print multimodal status
     */
    printStatus(): void;
    private resolvePath;
}
//# sourceMappingURL=multimodal.d.ts.map