import { query } from '../../db.js';

export interface IChatStorage {
  getAllConversations(): Promise<any[]>;
  getConversation(id: string | number): Promise<any | null>;
  getMessagesByConversation(conversationId: string | number): Promise<any[]>;
  createConversation(title: string): Promise<any>;
  deleteConversation(id: string | number): Promise<void>;
  createMessage(conversationId: string | number, role: string, content: string): Promise<any>;
}

class ChatStorage implements IChatStorage {
  async getAllConversations(): Promise<any[]> {
    const result = await query(
      `SELECT id, title, created_at, updated_at FROM chat_conversations ORDER BY updated_at DESC`
    );
    return result.rows;
  }

  async getConversation(id: string | number): Promise<any | null> {
    const result = await query(
      `SELECT id, title, created_at, updated_at FROM chat_conversations WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async getMessagesByConversation(conversationId: string | number): Promise<any[]> {
    const result = await query(
      `SELECT id, conversation_id, role, content, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId]
    );
    return result.rows;
  }

  async createConversation(title: string): Promise<any> {
    const result = await query(
      `INSERT INTO chat_conversations (title) VALUES ($1) RETURNING id, title, created_at, updated_at`,
      [title]
    );
    return result.rows[0];
  }

  async deleteConversation(id: string | number): Promise<void> {
    await query(`DELETE FROM chat_conversations WHERE id = $1`, [id]);
  }

  async createMessage(conversationId: string | number, role: string, content: string): Promise<any> {
    const result = await query(
      `INSERT INTO chat_messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING id, conversation_id, role, content, created_at`,
      [conversationId, role, content]
    );
    await query(
      `UPDATE chat_conversations SET updated_at = now() WHERE id = $1`,
      [conversationId]
    );
    return result.rows[0];
  }
}

export const chatStorage = new ChatStorage();
