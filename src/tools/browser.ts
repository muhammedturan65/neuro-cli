// ============================================================
// NeuroCLI - Browser Automation Tool
// Headless Chrome control via Chrome DevTools Protocol
// Fallback: curl-based HTTP requests when no browser available
// ============================================================

import { spawn, ChildProcess, execSync } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { createHash } from 'crypto';
import { ToolExecutor, ToolContext } from './registry.js';
import { ToolDefinition } from '../core/types.js';

// ============================================================
// Interfaces
// ============================================================

export interface BrowserConfig {
  headless: boolean;
  defaultTimeout: number;
  defaultViewport: { width: number; height: number };
  userAgent?: string;
  blockImages: boolean;
  blockCSS: boolean;
  stealth: boolean;
  proxy?: string;
  cookies?: Record<string, string>;
}

export interface BrowserAction {
  type: 'navigate' | 'click' | 'type' | 'select' | 'wait' | 'evaluate' | 'screenshot' | 'scroll' | 'download';
  target?: string;
  value?: string;
  timestamp: number;
  duration?: number;
  result?: 'success' | 'error';
  error?: string;
}

export interface BrowserSession {
  id: string;
  startedAt: number;
  currentUrl: string;
  title: string;
  statusCode: number;
  viewport: { width: number; height: number };
  actions: BrowserAction[];
  cookies: Record<string, string>;
  history: string[];
  historyIndex: number;
}

interface CDPRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface CDPResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface CDPEvent {
  method: string;
  params?: Record<string, unknown>;
}

// ============================================================
// Default Configuration
// ============================================================

const DEFAULT_CONFIG: BrowserConfig = {
  headless: true,
  defaultTimeout: 30000,
  defaultViewport: { width: 1280, height: 720 },
  blockImages: false,
  blockCSS: false,
  stealth: false,
};

const DEVICE_PRESETS: Record<string, { userAgent: string; viewport: { width: number; height: number }; deviceScaleFactor: number; isMobile: boolean; hasTouch: boolean }> = {
  'iphone-x': {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  'iphone-se': {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  'ipad-pro': {
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 1024, height: 1366 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  'pixel-7': {
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  },
  'galaxy-s21': {
    userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
    viewport: { width: 360, height: 800 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  'desktop-1080p': {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  'desktop-1440p': {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
    viewport: { width: 2560, height: 1440 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
};

// ============================================================
// CDP Connection Helper
// ============================================================

class CDPConnection {
  private ws: any = null;
  private requestId = 0;
  private pendingRequests: Map<number, { resolve: (value: any) => void; reject: (reason: any) => void }> = new Map();
  private eventHandlers: Map<string, Array<(params: any) => void>> = new Map();
  private buffer = '';
  private connected = false;

  constructor(private wsUrl: string) {}

  async connect(): Promise<void> {
    // Dynamic import of ws module - only if available
    try {
      // @ts-ignore
      const wsModule = await import('ws');
      const WebSocket = wsModule.default || wsModule.WebSocket || wsModule;

      return new Promise<void>((resolve, reject) => {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
          this.connected = true;
          resolve();
        });

        this.ws.on('message', (data: Buffer) => {
          this.handleMessage(data.toString());
        });

        this.ws.on('error', (err: Error) => {
          if (!this.connected) reject(err);
        });

        this.ws.on('close', () => {
          this.connected = false;
          // Reject all pending requests
          this.pendingRequests.forEach((pending) => {
            pending.reject(new Error('Connection closed'));
          });
          this.pendingRequests.clear();
        });

        // Timeout
        setTimeout(() => {
          if (!this.connected) {
            reject(new Error('Connection timeout'));
          }
        }, 10000);
      });
    } catch {
      throw new Error('WebSocket module not available. Install "ws" package or use curl fallback.');
    }
  }

  async send(method: string, params?: Record<string, unknown>): Promise<any> {
    if (!this.connected || !this.ws) {
      throw new Error('Not connected to browser');
    }

    const id = ++this.requestId;
    const message: CDPRequest = { id, method, params: params || {} };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`CDP request timeout: ${method}`));
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (value: any) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (reason: any) => {
          clearTimeout(timeout);
          reject(reason);
        },
      });

      this.ws.send(JSON.stringify(message));
    });
  }

  on(event: string, handler: (params: any) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  removeListener(event: string, handler: (params: any) => void): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
  }

  disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
      this.connected = false;
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Response to a request
      if (message.id !== undefined) {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          this.pendingRequests.delete(message.id);
          if (message.error) {
            pending.reject(new Error(`CDP error: ${message.error.message}`));
          } else {
            pending.resolve(message.result);
          }
        }
        return;
      }

      // Event from browser
      if (message.method) {
        const handlers = this.eventHandlers.get(message.method);
        if (handlers) {
          for (const handler of handlers) {
            try {
              handler(message.params);
            } catch {}
          }
        }
      }
    } catch {}
  }
}

// ============================================================
// Browser Tool Class
// ============================================================

export class BrowserTool {
  private config: BrowserConfig;
  private browserProcess: ChildProcess | null = null;
  private cdp: CDPConnection | null = null;
  private sessionId: string;
  private session: BrowserSession;
  private chromePath: string | null = null;
  private debugPort = 0;
  private useCurlFallback = false;
  private screenshotDir: string;

  constructor(config?: Partial<BrowserConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionId = createHash('md5').update(`browser-${Date.now()}-${Math.random()}`).digest('hex').slice(0, 12);
    this.screenshotDir = join(process.cwd(), '.neuro-screenshots');

    this.session = {
      id: this.sessionId,
      startedAt: Date.now(),
      currentUrl: '',
      title: '',
      statusCode: 0,
      viewport: { ...this.config.defaultViewport },
      actions: [],
      cookies: this.config.cookies ? { ...this.config.cookies } : {},
      history: [],
      historyIndex: -1,
    };
  }

  // ---- Lifecycle ----

  async launch(options?: Partial<BrowserConfig>): Promise<string> {
    if (options) {
      this.config = { ...this.config, ...options };
    }

    // Try to find a Chrome/Chromium executable
    this.chromePath = this.findChrome();
    if (!this.chromePath) {
      this.useCurlFallback = true;
      return 'Browser not found. Falling back to curl-based HTTP mode. Limited functionality available (navigate, getContent, getLinks, download).';
    }

    // Find a free debug port
    this.debugPort = this.findFreePort();

    const args: string[] = [
      `--remote-debugging-port=${this.debugPort}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-client-side-phishing-detection',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-hang-monitor',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--safebrowsing-disable-auto-update',
    ];

    if (this.config.headless) {
      args.push('--headless=new');
    }

    if (this.config.proxy) {
      args.push(`--proxy-server=${this.config.proxy}`);
    }

    // Stealth mode: reduce automation detection
    if (this.config.stealth) {
      args.push(
        '--disable-blink-features=AutomationControlled',
        '--excludeSwitches=enable-automation',
        '--disable-features=IsolateOrigins,site-per-process',
      );
    }

    // Block images
    if (this.config.blockImages) {
      args.push('--blink-settings=imagesEnabled=false');
    }

    // Set viewport
    args.push(`--window-size=${this.config.defaultViewport.width},${this.config.defaultViewport.height}`);

    return new Promise((resolve, reject) => {
      try {
        this.browserProcess = spawn(this.chromePath!, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        });

        let stderr = '';
        this.browserProcess.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
          // Detect when DevTools is ready
          if (stderr.includes('DevTools listening on')) {
            this.connectCDP().then(resolve).catch(reject);
          }
        });

        this.browserProcess.on('error', (err) => {
          this.useCurlFallback = true;
          resolve(`Browser launch failed: ${err.message}. Falling back to curl mode.`);
        });

        this.browserProcess.on('exit', () => {
          this.browserProcess = null;
          this.cdp = null;
        });

        // Timeout for CDP connection
        setTimeout(() => {
          if (!this.cdp || !this.cdp.isConnected) {
            this.connectCDP().then(resolve).catch(() => {
              this.useCurlFallback = true;
              resolve('Browser CDP connection timed out. Falling back to curl mode.');
            });
          }
        }, 5000);
      } catch (err) {
        this.useCurlFallback = true;
        resolve(`Browser launch error. Falling back to curl mode.`);
      }
    });
  }

  async close(): Promise<string> {
    if (this.cdp) {
      try {
        await this.cdp.send('Browser.close');
      } catch {}
      this.cdp.disconnect();
      this.cdp = null;
    }

    if (this.browserProcess) {
      try {
        this.browserProcess.kill('SIGTERM');
        // Force kill after 2 seconds
        setTimeout(() => {
          try { this.browserProcess?.kill('SIGKILL'); } catch {}
        }, 2000);
      } catch {}
      this.browserProcess = null;
    }

    return `Browser session ${this.sessionId} closed. ${this.session.actions.length} actions recorded.`;
  }

  // ---- Navigation ----

  async navigate(url: string): Promise<string> {
    const actionStart = Date.now();
    const action: BrowserAction = {
      type: 'navigate',
      target: url,
      timestamp: actionStart,
    };

    try {
      if (this.useCurlFallback) {
        return this.curlNavigate(url);
      }

      this.ensureConnected();

      // Set cookies before navigation if configured
      if (this.config.cookies && Object.keys(this.config.cookies).length > 0) {
        for (const [name, value] of Object.entries(this.config.cookies)) {
          await this.cdp!.send('Network.setCookie', {
            name,
            value,
            domain: new URL(url).hostname,
          });
        }
      }

      // Enable network tracking for status code
      await this.cdp!.send('Network.enable');

      let statusCode = 0;
      const responseHandler = (params: any) => {
        if (params.response?.url === url) {
          statusCode = params.response.status;
        }
      };
      this.cdp!.on('Network.responseReceived', responseHandler);

      const result = await this.cdp!.send('Page.navigate', { url });
      await this.cdp!.send('Page.loadEventFired');

      this.cdp!.removeListener('Network.responseReceived', responseHandler);

      // Update session
      this.session.currentUrl = url;
      this.session.statusCode = statusCode || 200;
      this.session.history = this.session.history.slice(0, this.session.historyIndex + 1);
      this.session.history.push(url);
      this.session.historyIndex = this.session.history.length - 1;

      // Get page title
      const titleResult = await this.cdp!.send('Runtime.evaluate', {
        expression: 'document.title',
      });
      this.session.title = titleResult?.result?.value || '';

      action.duration = Date.now() - actionStart;
      action.result = 'success';
      this.session.actions.push(action);

      return `Navigated to: ${url}\nTitle: ${this.session.title}\nStatus: ${this.session.statusCode}`;
    } catch (err: any) {
      action.duration = Date.now() - actionStart;
      action.result = 'error';
      action.error = err.message;
      this.session.actions.push(action);
      return `Navigation error: ${err.message}`;
    }
  }

  async goBack(): Promise<string> {
    if (this.useCurlFallback) {
      if (this.session.historyIndex > 0) {
        this.session.historyIndex--;
        return this.navigate(this.session.history[this.session.historyIndex]);
      }
      return 'No previous page in history';
    }

    this.ensureConnected();

    try {
      await this.cdp!.send('Page.goBack');
      await this.cdp!.send('Page.loadEventFired');

      if (this.session.historyIndex > 0) {
        this.session.historyIndex--;
        this.session.currentUrl = this.session.history[this.session.historyIndex];
      }

      return `Navigated back to: ${this.session.currentUrl}`;
    } catch (err: any) {
      return `Go back error: ${err.message}`;
    }
  }

  async goForward(): Promise<string> {
    if (this.useCurlFallback) {
      if (this.session.historyIndex < this.session.history.length - 1) {
        this.session.historyIndex++;
        return this.navigate(this.session.history[this.session.historyIndex]);
      }
      return 'No next page in history';
    }

    this.ensureConnected();

    try {
      await this.cdp!.send('Page.goForward');
      await this.cdp!.send('Page.loadEventFired');

      if (this.session.historyIndex < this.session.history.length - 1) {
        this.session.historyIndex++;
        this.session.currentUrl = this.session.history[this.session.historyIndex];
      }

      return `Navigated forward to: ${this.session.currentUrl}`;
    } catch (err: any) {
      return `Go forward error: ${err.message}`;
    }
  }

  // ---- Page Interaction ----

  async screenshot(selector?: string): Promise<string> {
    if (this.useCurlFallback) {
      return 'Screenshot not available in curl fallback mode';
    }

    this.ensureConnected();

    const actionStart = Date.now();
    const action: BrowserAction = {
      type: 'screenshot',
      target: selector,
      timestamp: actionStart,
    };

    try {
      if (!existsSync(this.screenshotDir)) {
        mkdirSync(this.screenshotDir, { recursive: true });
      }

      let screenshotData: string;

      if (selector) {
        // Screenshot a specific element
        const elementResult = await this.cdp!.send('Runtime.evaluate', {
          expression: `
            (function() {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return null;
              const rect = el.getBoundingClientRect();
              return JSON.stringify({
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                scale: window.devicePixelRatio || 1
              });
            })()
          `,
        });

        if (!elementResult?.result?.value) {
          return `Element not found: ${selector}`;
        }

        const clip = JSON.parse(elementResult.result.value);
        const result = await this.cdp!.send('Page.captureScreenshot', {
          format: 'png',
          clip: {
            x: clip.x,
            y: clip.y,
            width: clip.width,
            height: clip.height,
            scale: clip.scale,
          },
        });

        screenshotData = result.data;
      } else {
        // Full page screenshot
        const metrics = await this.cdp!.send('Page.getLayoutMetrics');
        const width = Math.ceil(metrics.cssContentSize?.width || this.config.defaultViewport.width);
        const height = Math.ceil(metrics.cssContentSize?.height || this.config.defaultViewport.height);

        await this.cdp!.send('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: false,
        });

        const result = await this.cdp!.send('Page.captureScreenshot', {
          format: 'png',
        });

        screenshotData = result.data;

        // Reset viewport
        await this.cdp!.send('Emulation.setDeviceMetricsOverride', {
          width: this.session.viewport.width,
          height: this.session.viewport.height,
          deviceScaleFactor: 1,
          mobile: false,
        });
      }

      // Save to file
      const filename = `screenshot-${Date.now()}.png`;
      const filepath = join(this.screenshotDir, filename);
      const buffer = Buffer.from(screenshotData, 'base64');
      writeFileSync(filepath, buffer);

      action.duration = Date.now() - actionStart;
      action.result = 'success';
      this.session.actions.push(action);

      return `Screenshot saved: ${filepath} (${(buffer.length / 1024).toFixed(1)}KB)`;
    } catch (err: any) {
      action.duration = Date.now() - actionStart;
      action.result = 'error';
      action.error = err.message;
      this.session.actions.push(action);
      return `Screenshot error: ${err.message}`;
    }
  }

  async click(selector: string): Promise<string> {
    if (this.useCurlFallback) {
      return 'Click not available in curl fallback mode';
    }

    this.ensureConnected();

    const actionStart = Date.now();
    const action: BrowserAction = {
      type: 'click',
      target: selector,
      timestamp: actionStart,
    };

    try {
      // Get element position
      const elementResult = await this.cdp!.send('Runtime.evaluate', {
        expression: `
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return JSON.stringify({
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2
            });
          })()
        `,
      });

      if (!elementResult?.result?.value) {
        action.result = 'error';
        action.error = `Element not found: ${selector}`;
        this.session.actions.push(action);
        return `Element not found: ${selector}`;
      }

      const { x, y } = JSON.parse(elementResult.result.value);

      // Dispatch mouse events
      await this.cdp!.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1,
      });

      await this.cdp!.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1,
      });

      // Small delay for any JS handlers
      await this.delay(100);

      action.duration = Date.now() - actionStart;
      action.result = 'success';
      this.session.actions.push(action);

      return `Clicked: ${selector} at (${x.toFixed(0)}, ${y.toFixed(0)})`;
    } catch (err: any) {
      action.duration = Date.now() - actionStart;
      action.result = 'error';
      action.error = err.message;
      this.session.actions.push(action);
      return `Click error: ${err.message}`;
    }
  }

  async type(selector: string, text: string): Promise<string> {
    if (this.useCurlFallback) {
      return 'Type not available in curl fallback mode';
    }

    this.ensureConnected();

    const actionStart = Date.now();
    const action: BrowserAction = {
      type: 'type',
      target: selector,
      value: text,
      timestamp: actionStart,
    };

    try {
      // Focus the element first
      await this.cdp!.send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(selector)})?.focus()`,
      });

      // Clear existing content
      await this.cdp!.send('Runtime.evaluate', {
        expression: `
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (el) {
              el.value = '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          })()
        `,
      });

      // Type each character for realistic input
      for (const char of text) {
        await this.cdp!.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          text: char,
          key: char,
        });

        await this.delay(10);

        await this.cdp!.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: char,
        });

        await this.delay(10);
      }

      // Trigger change event
      await this.cdp!.send('Runtime.evaluate', {
        expression: `
          document.querySelector(${JSON.stringify(selector)})?.dispatchEvent(new Event('change', { bubbles: true }))
        `,
      });

      action.duration = Date.now() - actionStart;
      action.result = 'success';
      this.session.actions.push(action);

      return `Typed "${text.length > 50 ? text.slice(0, 50) + '...' : text}" into ${selector}`;
    } catch (err: any) {
      action.duration = Date.now() - actionStart;
      action.result = 'error';
      action.error = err.message;
      this.session.actions.push(action);
      return `Type error: ${err.message}`;
    }
  }

  async select(selector: string, value: string): Promise<string> {
    if (this.useCurlFallback) {
      return 'Select not available in curl fallback mode';
    }

    this.ensureConnected();

    const actionStart = Date.now();
    const action: BrowserAction = {
      type: 'select',
      target: selector,
      value,
      timestamp: actionStart,
    };

    try {
      const result = await this.cdp!.send('Runtime.evaluate', {
        expression: `
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el || el.tagName !== 'SELECT') return { error: 'Not a select element' };
            el.value = ${JSON.stringify(value)};
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { selectedValue: el.value };
          })()
        `,
        returnByValue: true,
      });

      action.duration = Date.now() - actionStart;

      if (result?.result?.value?.error) {
        action.result = 'error';
        action.error = result.result.value.error;
        this.session.actions.push(action);
        return `Select error: ${result.result.value.error}`;
      }

      action.result = 'success';
      this.session.actions.push(action);

      return `Selected "${value}" in ${selector}`;
    } catch (err: any) {
      action.duration = Date.now() - actionStart;
      action.result = 'error';
      action.error = err.message;
      this.session.actions.push(action);
      return `Select error: ${err.message}`;
    }
  }

  async wait(selector: string, timeout?: number): Promise<string> {
    if (this.useCurlFallback) {
      return 'Wait not available in curl fallback mode';
    }

    this.ensureConnected();

    const actionStart = Date.now();
    const waitTimeout = timeout || this.config.defaultTimeout;
    const action: BrowserAction = {
      type: 'wait',
      target: selector,
      timestamp: actionStart,
    };

    try {
      const result = await this.cdp!.send('Runtime.evaluate', {
        expression: `
          new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout waiting for ${selector}')), ${waitTimeout});
            const check = () => {
              if (document.querySelector(${JSON.stringify(selector)})) {
                clearTimeout(timeout);
                resolve(true);
              } else {
                requestAnimationFrame(check);
              }
            };
            check();
          })
        `,
        awaitPromise: true,
        returnByValue: true,
      });

      action.duration = Date.now() - actionStart;
      action.result = 'success';
      this.session.actions.push(action);

      return `Element found: ${selector} (waited ${action.duration}ms)`;
    } catch (err: any) {
      action.duration = Date.now() - actionStart;
      action.result = 'error';
      action.error = err.message;
      this.session.actions.push(action);
      return `Wait error: ${err.message}`;
    }
  }

  // ---- Page Evaluation ----

  async evaluate(script: string): Promise<string> {
    if (this.useCurlFallback) {
      return 'JavaScript evaluation not available in curl fallback mode';
    }

    this.ensureConnected();

    const actionStart = Date.now();
    const action: BrowserAction = {
      type: 'evaluate',
      value: script.slice(0, 200),
      timestamp: actionStart,
    };

    try {
      const result = await this.cdp!.send('Runtime.evaluate', {
        expression: script,
        returnByValue: true,
        awaitPromise: true,
      });

      action.duration = Date.now() - actionStart;

      if (result?.exceptionDetails) {
        action.result = 'error';
        action.error = result.exceptionDetails.text || 'Evaluation error';
        this.session.actions.push(action);
        return `Evaluation error: ${result.exceptionDetails.text}\n${result.exceptionDetails.exception?.description || ''}`;
      }

      action.result = 'success';
      this.session.actions.push(action);

      const value = result?.result?.value;
      const output = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? 'undefined');

      return truncateOutput(`Result: ${output}`);
    } catch (err: any) {
      action.duration = Date.now() - actionStart;
      action.result = 'error';
      action.error = err.message;
      this.session.actions.push(action);
      return `Evaluate error: ${err.message}`;
    }
  }

  // ---- Content Extraction ----

  async getContent(selector?: string): Promise<string> {
    if (this.useCurlFallback) {
      return this.curlGetContent();
    }

    this.ensureConnected();

    try {
      const expression = selector
        ? `document.querySelector(${JSON.stringify(selector)})?.innerText || document.querySelector(${JSON.stringify(selector)})?.outerHTML || ''`
        : `document.body.innerText`;

      const result = await this.cdp!.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
      });

      const content = result?.result?.value || '';

      if (selector && !content) {
        // Try outerHTML
        const htmlResult = await this.cdp!.send('Runtime.evaluate', {
          expression: `document.querySelector(${JSON.stringify(selector)})?.outerHTML || ''`,
          returnByValue: true,
        });

        return truncateOutput(htmlResult?.result?.value || `Element not found: ${selector}`);
      }

      return truncateOutput(content || 'No content found');
    } catch (err: any) {
      return `Get content error: ${err.message}`;
    }
  }

  async getLinks(): Promise<string> {
    if (this.useCurlFallback) {
      return this.curlGetLinks();
    }

    this.ensureConnected();

    try {
      const result = await this.cdp!.send('Runtime.evaluate', {
        expression: `
          Array.from(document.querySelectorAll('a[href]')).map(a => ({
            text: a.innerText.trim().slice(0, 100),
            href: a.href,
            target: a.target
          }))
        `,
        returnByValue: true,
      });

      const links: Array<{ text: string; href: string; target: string }> = result?.result?.value || [];

      if (links.length === 0) {
        return 'No links found on this page';
      }

      const formatted = links.map((link, i) => {
        const text = link.text || '(no text)';
        return `${i + 1}. ${text}\n   ${link.href}${link.target ? ` [target=${link.target}]` : ''}`;
      }).join('\n\n');

      return `Found ${links.length} links:\n\n${truncateOutput(formatted)}`;
    } catch (err: any) {
      return `Get links error: ${err.message}`;
    }
  }

  async getForms(): Promise<string> {
    if (this.useCurlFallback) {
      return 'Form extraction not available in curl fallback mode';
    }

    this.ensureConnected();

    try {
      const result = await this.cdp!.send('Runtime.evaluate', {
        expression: `
          Array.from(document.forms).map((form, i) => ({
            index: i,
            id: form.id,
            name: form.name,
            action: form.action,
            method: form.method,
            fields: Array.from(form.elements).map(el => ({
              tag: el.tagName,
              type: el.type,
              name: el.name,
              id: el.id,
              value: el.type === 'password' ? '***' : (el.value || ''),
              required: el.required,
              placeholder: el.placeholder
            }))
          }))
        `,
        returnByValue: true,
      });

      const forms: Array<{
        index: number;
        id: string;
        name: string;
        action: string;
        method: string;
        fields: Array<{ tag: string; type: string; name: string; id: string; value: string; required: boolean; placeholder: string }>;
      }> = result?.result?.value || [];

      if (forms.length === 0) {
        return 'No forms found on this page';
      }

      const formatted = forms.map(form => {
        const header = `Form ${form.index + 1}: ${form.name || form.id || '(unnamed)'}`;
        const meta = `  Action: ${form.action} | Method: ${form.method.toUpperCase()}`;
        const fields = form.fields.map(f => {
          const label = f.name || f.id || f.type;
          const details: string[] = [f.tag.toLowerCase()];
          if (f.type) details.push(`type=${f.type}`);
          if (f.required) details.push('required');
          if (f.placeholder) details.push(`placeholder="${f.placeholder}"`);
          if (f.value) details.push(`value="${f.value.slice(0, 50)}"`);
          return `    - ${label}: ${details.join(', ')}`;
        }).join('\n');
        return `${header}\n${meta}\n  Fields:\n${fields}`;
      }).join('\n\n');

      return `Found ${forms.length} form(s):\n\n${formatted}`;
    } catch (err: any) {
      return `Get forms error: ${err.message}`;
    }
  }

  async fillForm(selector: string, data: Record<string, string>): Promise<string> {
    if (this.useCurlFallback) {
      return 'Form filling not available in curl fallback mode';
    }

    this.ensureConnected();

    const actionStart = Date.now();
    const action: BrowserAction = {
      type: 'type',
      target: selector,
      value: JSON.stringify(data),
      timestamp: actionStart,
    };

    try {
      // Fill each field
      const results: string[] = [];
      for (const [name, value] of Object.entries(data)) {
        const fillResult = await this.cdp!.send('Runtime.evaluate', {
          expression: `
            (function() {
              const form = document.querySelector(${JSON.stringify(selector)});
              if (!form) return { error: 'Form not found' };

              // Try finding by name, then id
              let el = form.elements.namedItem(${JSON.stringify(name)}) ||
                       form.querySelector('#' + ${JSON.stringify(name)}) ||
                       form.querySelector('[name="' + ${JSON.stringify(name)} + '"]');

              if (!el) return { error: 'Field not found: ${name}' };

              if (el.tagName === 'SELECT') {
                el.value = ${JSON.stringify(value)};
              } else if (el.type === 'checkbox') {
                el.checked = ${JSON.stringify(value)} === 'true' || ${JSON.stringify(value)} === 'on';
              } else if (el.type === 'radio') {
                const radio = form.querySelector('input[name="${name}"][value="${value}"]');
                if (radio) radio.checked = true;
              } else {
                el.value = ${JSON.stringify(value)};
              }

              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true, field: '${name}' };
            })()
          `,
          returnByValue: true,
        });

        if (fillResult?.result?.value?.error) {
          results.push(`  ⚠ ${name}: ${fillResult.result.value.error}`);
        } else {
          results.push(`  ✓ ${name}: set to "${value.slice(0, 50)}"`);
        }
      }

      action.duration = Date.now() - actionStart;
      action.result = 'success';
      this.session.actions.push(action);

      return `Form fill results:\n${results.join('\n')}`;
    } catch (err: any) {
      action.duration = Date.now() - actionStart;
      action.result = 'error';
      action.error = err.message;
      this.session.actions.push(action);
      return `Fill form error: ${err.message}`;
    }
  }

  // ---- File Download ----

  async download(url: string, outputPath: string): Promise<string> {
    const actionStart = Date.now();
    const action: BrowserAction = {
      type: 'download',
      target: url,
      value: outputPath,
      timestamp: actionStart,
    };

    try {
      const absolutePath = resolve(outputPath);
      const dir = join(absolutePath, '..');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Use curl for downloads (works in both modes)
      const result = execSync(
        `curl -L -s -o "${absolutePath}" -w "%{http_code}|%{size_download}|%{content_type}" "${url}"`,
        { encoding: 'utf-8', timeout: 120000 }
      );

      const [statusCode, size, contentType] = result.split('|');

      action.duration = Date.now() - actionStart;
      action.result = 'success';
      this.session.actions.push(action);

      return `Downloaded: ${url}\n  → ${absolutePath}\n  Size: ${(Number(size) / 1024).toFixed(1)}KB | Status: ${statusCode} | Type: ${contentType}`;
    } catch (err: any) {
      action.duration = Date.now() - actionStart;
      action.result = 'error';
      action.error = err.message;
      this.session.actions.push(action);
      return `Download error: ${err.message}`;
    }
  }

  // ---- Scroll ----

  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount: number = 300): Promise<string> {
    if (this.useCurlFallback) {
      return 'Scroll not available in curl fallback mode';
    }

    this.ensureConnected();

    const actionStart = Date.now();
    const action: BrowserAction = {
      type: 'scroll',
      value: `${direction} ${amount}`,
      timestamp: actionStart,
    };

    try {
      let scrollExpr: string;
      switch (direction) {
        case 'down':
          scrollExpr = `window.scrollBy(0, ${amount})`;
          break;
        case 'up':
          scrollExpr = `window.scrollBy(0, -${amount})`;
          break;
        case 'right':
          scrollExpr = `window.scrollBy(${amount}, 0)`;
          break;
        case 'left':
          scrollExpr = `window.scrollBy(-${amount}, 0)`;
          break;
      }

      await this.cdp!.send('Runtime.evaluate', {
        expression: scrollExpr,
      });

      // Get scroll position
      const posResult = await this.cdp!.send('Runtime.evaluate', {
        expression: `JSON.stringify({ x: window.scrollX, y: window.scrollY })`,
        returnByValue: true,
      });

      const pos = JSON.parse(posResult?.result?.value || '{}');

      action.duration = Date.now() - actionStart;
      action.result = 'success';
      this.session.actions.push(action);

      return `Scrolled ${direction} by ${amount}px. Position: (${pos.x}, ${pos.y})`;
    } catch (err: any) {
      action.duration = Date.now() - actionStart;
      action.result = 'error';
      action.error = err.message;
      this.session.actions.push(action);
      return `Scroll error: ${err.message}`;
    }
  }

  // ---- Page Info ----

  async getPageInfo(): Promise<string> {
    if (this.useCurlFallback) {
      return `Session: ${this.session.id}\nMode: curl fallback\nURL: ${this.session.currentUrl || 'none'}\nActions: ${this.session.actions.length}`;
    }

    try {
      this.ensureConnected();

      const infoResult = await this.cdp!.send('Runtime.evaluate', {
        expression: `
          JSON.stringify({
            url: window.location.href,
            title: document.title,
            charset: document.characterSet,
            language: document.documentElement.lang,
            referrer: document.referrer,
            readyState: document.readyState,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            scrollPosition: { x: window.scrollX, y: window.scrollY },
            documentHeight: document.documentElement.scrollHeight,
            cookieCount: document.cookie.split(';').filter(c => c.trim()).length,
            linkCount: document.querySelectorAll('a').length,
            imageCount: document.querySelectorAll('img').length,
            formCount: document.forms.length,
            scriptCount: document.querySelectorAll('script').length,
          })
        `,
        returnByValue: true,
      });

      const info = JSON.parse(infoResult?.result?.value || '{}');

      return [
        `Page Info:`,
        `  URL: ${info.url || this.session.currentUrl}`,
        `  Title: ${info.title || this.session.title}`,
        `  Status: ${this.session.statusCode}`,
        `  Charset: ${info.charset || 'unknown'}`,
        `  Language: ${info.language || 'unknown'}`,
        `  Ready State: ${info.readyState}`,
        `  Viewport: ${info.viewport?.width}x${info.viewport?.height}`,
        `  Scroll: (${info.scrollPosition?.x}, ${info.scrollPosition?.y})`,
        `  Document Height: ${info.documentHeight}px`,
        `  Links: ${info.linkCount} | Images: ${info.imageCount} | Forms: ${info.formCount} | Scripts: ${info.scriptCount}`,
        `  Cookies: ${info.cookieCount}`,
        ``,
        `Session: ${this.session.id}`,
        `  Actions: ${this.session.actions.length}`,
        `  Duration: ${((Date.now() - this.session.startedAt) / 1000).toFixed(1)}s`,
      ].join('\n');
    } catch (err: any) {
      return `Page info error: ${err.message}`;
    }
  }

  // ---- Viewport & Device Emulation ----

  async setViewport(width: number, height: number): Promise<string> {
    this.session.viewport = { width, height };

    if (this.useCurlFallback || !this.cdp?.isConnected) {
      return `Viewport set to ${width}x${height} (will apply on next navigation)`;
    }

    try {
      await this.cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });

      return `Viewport set to ${width}x${height}`;
    } catch (err: any) {
      return `Set viewport error: ${err.message}`;
    }
  }

  async emulateDevice(device: string): Promise<string> {
    const preset = DEVICE_PRESETS[device.toLowerCase()];
    if (!preset) {
      const available = Object.keys(DEVICE_PRESETS).join(', ');
      return `Unknown device: ${device}. Available: ${available}`;
    }

    this.session.viewport = { ...preset.viewport };

    if (this.config.stealth || preset.userAgent) {
      this.config.userAgent = preset.userAgent;
    }

    if (this.useCurlFallback || !this.cdp?.isConnected) {
      return `Device emulation set to ${device} (${preset.viewport.width}x${preset.viewport.height}). Will apply on next navigation.`;
    }

    try {
      await this.cdp.send('Emulation.setDeviceMetricsOverride', {
        width: preset.viewport.width,
        height: preset.viewport.height,
        deviceScaleFactor: preset.deviceScaleFactor,
        mobile: preset.isMobile,
      });

      await this.cdp.send('Network.setUserAgentOverride', {
        userAgent: preset.userAgent,
      });

      if (preset.hasTouch) {
        await this.cdp.send('Emulation.setTouchEmulationEnabled', {
          enabled: true,
          maxTouchPoints: 5,
        });
      }

      return `Emulating ${device}: ${preset.viewport.width}x${preset.viewport.height}, mobile=${preset.isMobile}, touch=${preset.hasTouch}`;
    } catch (err: any) {
      return `Emulate device error: ${err.message}`;
    }
  }

  // ---- Session Management ----

  getSession(): BrowserSession {
    return { ...this.session, actions: [...this.session.actions] };
  }

  getActionHistory(): BrowserAction[] {
    return [...this.session.actions];
  }

  isUsingFallback(): boolean {
    return this.useCurlFallback;
  }

  // ---- Private Helpers ----

  private findChrome(): string | null {
    const candidates: string[] = [];

    switch (process.platform) {
      case 'darwin':
        candidates.push(
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        );
        break;
      case 'linux':
        candidates.push(
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
          '/snap/bin/chromium',
          '/usr/bin/brave-browser',
        );
        break;
      case 'win32':
        candidates.push(
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
          `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.PROGRAMFILES || ''}\\Google\\Chrome\\Application\\chrome.exe`,
        );
        break;
    }

    // Check CHROME_PATH env var
    const envPath = process.env.CHROME_PATH || process.env.CHROMIUM_PATH;
    if (envPath && existsSync(envPath)) {
      return envPath;
    }

    // Try which/where command
    try {
      const cmd = process.platform === 'win32' ? 'where chrome' : 'which google-chrome || which chromium-browser || which chromium';
      const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
      if (result && existsSync(result.split('\n')[0].trim())) {
        return result.split('\n')[0].trim();
      }
    } catch {}

    // Check candidate paths
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private findFreePort(): number {
    // Generate a random port in the dynamic range
    return 9222 + Math.floor(Math.random() * 1000);
  }

  private async connectCDP(): Promise<string> {
    try {
      // Get browser info from debug endpoint
      const response = await fetch(`http://127.0.0.1:${this.debugPort}/json/version`);
      const info = await response.json() as any;

      const wsUrl = info.webSocketDebuggerUrl;
      if (!wsUrl) {
        throw new Error('No WebSocket URL found');
      }

      // Connect via CDP
      this.cdp = new CDPConnection(wsUrl);
      await this.cdp.connect();

      // Set up stealth overrides
      if (this.config.stealth) {
        await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', {
          source: `
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            window.chrome = { runtime: {} };
          `,
        });
      }

      // Set user agent if specified
      if (this.config.userAgent) {
        await this.cdp.send('Network.setUserAgentOverride', {
          userAgent: this.config.userAgent,
        });
      }

      // Block resources if configured
      if (this.config.blockImages || this.config.blockCSS) {
        await this.cdp.send('Network.setBlockedURLs', {
          urls: [
            ...(this.config.blockImages ? ['*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.svg'] : []),
            ...(this.config.blockCSS ? ['*.css'] : []),
          ],
        });
      }

      this.useCurlFallback = false;
      return `Browser connected via CDP on port ${this.debugPort}`;
    } catch (err: any) {
      this.useCurlFallback = true;
      return `CDP connection failed: ${err.message}. Using curl fallback.`;
    }
  }

  private ensureConnected(): void {
    if (!this.cdp || !this.cdp.isConnected) {
      throw new Error('Browser not connected. Call launch() first.');
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ---- Curl Fallback Methods ----

  private async curlNavigate(url: string): Promise<string> {
    try {
      const result = execSync(
        `curl -L -s -o /dev/null -w "%{http_code}|%{url_effective}|%{content_type}" "${url}"`,
        { encoding: 'utf-8', timeout: this.config.defaultTimeout }
      );

      const [statusCode, effectiveUrl, contentType] = result.split('|');
      this.session.currentUrl = effectiveUrl || url;
      this.session.statusCode = parseInt(statusCode, 10);
      this.session.history.push(this.session.currentUrl);
      this.session.historyIndex = this.session.history.length - 1;

      const action: BrowserAction = {
        type: 'navigate',
        target: url,
        timestamp: Date.now(),
        result: 'success',
        duration: 0,
      };
      this.session.actions.push(action);

      return `Navigated to: ${this.session.currentUrl}\nStatus: ${this.session.statusCode}\nContent-Type: ${contentType}`;
    } catch (err: any) {
      const action: BrowserAction = {
        type: 'navigate',
        target: url,
        timestamp: Date.now(),
        result: 'error',
        error: err.message,
      };
      this.session.actions.push(action);
      return `Navigation error: ${err.message}`;
    }
  }

  private async curlGetContent(): Promise<string> {
    if (!this.session.currentUrl) {
      return 'No URL loaded. Navigate first.';
    }

    try {
      const result = execSync(
        `curl -L -s --max-time 30 "${this.session.currentUrl}"`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 35000 }
      );

      // Basic HTML to text conversion
      const text = result
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

      return truncateOutput(text);
    } catch (err: any) {
      return `Get content error: ${err.message}`;
    }
  }

  private async curlGetLinks(): Promise<string> {
    if (!this.session.currentUrl) {
      return 'No URL loaded. Navigate first.';
    }

    try {
      const result = execSync(
        `curl -L -s --max-time 30 "${this.session.currentUrl}"`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 35000 }
      );

      // Extract links from HTML
      const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
      const links: Array<{ text: string; href: string }> = [];
      let match;

      while ((match = linkRegex.exec(result)) !== null) {
        const href = match[1];
        const text = match[2].trim();
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          // Resolve relative URLs
          const resolved = new URL(href, this.session.currentUrl).href;
          links.push({ text: text.slice(0, 100) || '(no text)', href: resolved });
        }
      }

      if (links.length === 0) {
        return 'No links found on this page';
      }

      const formatted = links.slice(0, 100).map((link, i) => {
        return `${i + 1}. ${link.text}\n   ${link.href}`;
      }).join('\n\n');

      return `Found ${links.length} links:\n\n${truncateOutput(formatted)}`;
    } catch (err: any) {
      return `Get links error: ${err.message}`;
    }
  }
}

// ============================================================
// Tool Registration (compatible with NeuroCLI ToolExecutor)
// ============================================================

function truncateOutput(output: string, maxLength: number = 30000): string {
  if (output.length <= maxLength) return output;
  const half = Math.floor(maxLength / 2);
  return output.slice(0, half) + '\n\n... [truncated] ...\n\n' + output.slice(-half);
}

// Singleton browser instance for tool use
let browserInstance: BrowserTool | null = null;

async function getBrowser(): Promise<BrowserTool> {
  if (!browserInstance) {
    browserInstance = new BrowserTool();
    await browserInstance.launch();
  }
  return browserInstance;
}

// ---- Browser Navigate Tool ----
const browserNavigateDef: ToolDefinition = {
  name: 'browser_navigate',
  description: 'Navigate the headless browser to a URL. Launches browser if not already running.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to navigate to' },
    },
    required: ['url'],
  },
};

export const browserNavigateTool: ToolExecutor = {
  name: 'browser_navigate',
  definition: browserNavigateDef,
  risk: 'low',
  async execute(args) {
    const browser = await getBrowser();
    return browser.navigate(args.url as string);
  },
};

// ---- Browser Screenshot Tool ----
const browserScreenshotDef: ToolDefinition = {
  name: 'browser_screenshot',
  description: 'Take a screenshot of the current page or a specific element.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector for element screenshot (optional, full page if omitted)' },
    },
    required: [],
  },
};

export const browserScreenshotTool: ToolExecutor = {
  name: 'browser_screenshot',
  definition: browserScreenshotDef,
  risk: 'low',
  async execute(args) {
    const browser = await getBrowser();
    return browser.screenshot(args.selector as string | undefined);
  },
};

// ---- Browser Click Tool ----
const browserClickDef: ToolDefinition = {
  name: 'browser_click',
  description: 'Click an element on the page by CSS selector.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector of the element to click' },
    },
    required: ['selector'],
  },
};

export const browserClickTool: ToolExecutor = {
  name: 'browser_click',
  definition: browserClickDef,
  risk: 'medium',
  async execute(args) {
    const browser = await getBrowser();
    return browser.click(args.selector as string);
  },
};

// ---- Browser Type Tool ----
const browserTypeDef: ToolDefinition = {
  name: 'browser_type',
  description: 'Type text into a form element by CSS selector.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector of the input element' },
      text: { type: 'string', description: 'Text to type' },
    },
    required: ['selector', 'text'],
  },
};

export const browserTypeTool: ToolExecutor = {
  name: 'browser_type',
  definition: browserTypeDef,
  risk: 'medium',
  async execute(args) {
    const browser = await getBrowser();
    return browser.type(args.selector as string, args.text as string);
  },
};

// ---- Browser Evaluate Tool ----
const browserEvaluateDef: ToolDefinition = {
  name: 'browser_evaluate',
  description: 'Execute JavaScript in the browser page context.',
  parameters: {
    type: 'object',
    properties: {
      script: { type: 'string', description: 'JavaScript code to execute' },
    },
    required: ['script'],
  },
};

export const browserEvaluateTool: ToolExecutor = {
  name: 'browser_evaluate',
  definition: browserEvaluateDef,
  risk: 'high',
  getApprovalRequest(args) {
    return {
      toolName: 'browser_evaluate',
      args,
      risk: 'high',
      description: `Execute JS in browser: ${(args.script as string).slice(0, 100)}...`,
    };
  },
  async execute(args) {
    const browser = await getBrowser();
    return browser.evaluate(args.script as string);
  },
};

// ---- Browser Get Content Tool ----
const browserGetContentDef: ToolDefinition = {
  name: 'browser_get_content',
  description: 'Get the text content of the current page or a specific element.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector (optional, gets full page text if omitted)' },
    },
    required: [],
  },
};

export const browserGetContentTool: ToolExecutor = {
  name: 'browser_get_content',
  definition: browserGetContentDef,
  risk: 'low',
  async execute(args) {
    const browser = await getBrowser();
    return browser.getContent(args.selector as string | undefined);
  },
};

// ---- Browser Get Links Tool ----
const browserGetLinksDef: ToolDefinition = {
  name: 'browser_get_links',
  description: 'Extract all links from the current page.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const browserGetLinksTool: ToolExecutor = {
  name: 'browser_get_links',
  definition: browserGetLinksDef,
  risk: 'low',
  async execute() {
    const browser = await getBrowser();
    return browser.getLinks();
  },
};

// ---- Browser Download Tool ----
const browserDownloadDef: ToolDefinition = {
  name: 'browser_download',
  description: 'Download a file from a URL to a local path.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to download from' },
      output_path: { type: 'string', description: 'Local file path to save to' },
    },
    required: ['url', 'output_path'],
  },
};

export const browserDownloadTool: ToolExecutor = {
  name: 'browser_download',
  definition: browserDownloadDef,
  risk: 'medium',
  getApprovalRequest(args) {
    return {
      toolName: 'browser_download',
      args,
      risk: 'medium',
      description: `Download ${args.url} to ${args.output_path}`,
    };
  },
  async execute(args) {
    const browser = await getBrowser();
    return browser.download(args.url as string, args.output_path as string);
  },
};

// Export all browser tools
export const browserTools: ToolExecutor[] = [
  browserNavigateTool,
  browserScreenshotTool,
  browserClickTool,
  browserTypeTool,
  browserEvaluateTool,
  browserGetContentTool,
  browserGetLinksTool,
  browserDownloadTool,
];
