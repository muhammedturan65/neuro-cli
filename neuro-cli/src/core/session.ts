// ============================================================
// NeuroCLI - Session Manager
// Persistent conversation sessions
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Session, Message, AgentExecution } from '../core/types.js';

const SESSION_DIR = join(homedir(), '.neuro', 'sessions');

export class SessionManager {
  private currentSession: Session | null = null;

  /**
   * Create a new session
   */
  create(workingDirectory: string, model: string): Session {
    this.currentSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      workingDirectory,
      model,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      agentHistory: [],
    };
    this.save();
    return this.currentSession;
  }

  /**
   * Load an existing session
   */
  load(sessionId: string): Session | null {
    const filePath = join(SESSION_DIR, `${sessionId}.json`);
    if (!existsSync(filePath)) return null;

    try {
      const data = readFileSync(filePath, 'utf-8');
      this.currentSession = JSON.parse(data);
      return this.currentSession;
    } catch {
      return null;
    }
  }

  /**
   * Get the current session
   */
  getCurrent(): Session | null {
    return this.currentSession;
  }

  /**
   * Save the current session
   */
  save(): void {
    if (!this.currentSession) return;

    if (!existsSync(SESSION_DIR)) {
      mkdirSync(SESSION_DIR, { recursive: true });
    }

    this.currentSession.updatedAt = Date.now();
    const filePath = join(SESSION_DIR, `${this.currentSession.id}.json`);
    writeFileSync(filePath, JSON.stringify(this.currentSession, null, 2), 'utf-8');
  }

  /**
   * Add a message to the current session
   */
  addMessage(message: Message): void {
    if (!this.currentSession) return;
    this.currentSession.messages.push(message);
  }

  /**
   * Add an agent execution record
   */
  addAgentExecution(execution: AgentExecution): void {
    if (!this.currentSession) return;
    this.currentSession.agentHistory.push(execution);
  }

  /**
   * Update token usage
   */
  updateUsage(inputTokens: number, outputTokens: number, cost: number): void {
    if (!this.currentSession) return;
    this.currentSession.totalInputTokens += inputTokens;
    this.currentSession.totalOutputTokens += outputTokens;
    this.currentSession.totalCost += cost;
  }

  /**
   * List all sessions
   */
  list(): Array<{ id: string; createdAt: number; messageCount: number; model: string; cost: number }> {
    if (!existsSync(SESSION_DIR)) return [];

    const sessions: Array<{ id: string; createdAt: number; messageCount: number; model: string; cost: number }> = [];

    for (const file of readdirSync(SESSION_DIR)) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(readFileSync(join(SESSION_DIR, file), 'utf-8'));
        sessions.push({
          id: data.id,
          createdAt: data.createdAt,
          messageCount: data.messages?.length || 0,
          model: data.model,
          cost: data.totalCost || 0,
        });
      } catch {}
    }

    return sessions.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Delete a session
   */
  delete(sessionId: string): boolean {
    const filePath = join(SESSION_DIR, `${sessionId}.json`);
    if (!existsSync(filePath)) return false;
    try {
      unlinkSync(filePath);
      if (this.currentSession?.id === sessionId) {
        this.currentSession = null;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get session statistics
   */
  getStats(): { totalSessions: number; totalMessages: number; totalCost: number; totalTokens: number } {
    const sessions = this.list();
    let totalMessages = 0;
    let totalCost = 0;

    for (const session of sessions) {
      totalMessages += session.messageCount;
      totalCost += session.cost;
    }

    return {
      totalSessions: sessions.length,
      totalMessages,
      totalCost,
      totalTokens: 0, // Would need to sum from all sessions
    };
  }
}
