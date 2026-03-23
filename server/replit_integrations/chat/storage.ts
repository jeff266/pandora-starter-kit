import { query } from '../../db.js';

export interface Conversation {
  id: number;
  title: string;
  created_at: Date;
  updated_at: Date;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  created_at: Date;
}

export interface IChatStorage {
  getAllConversations(): Promise<Conversation[]>;
  getConversation(id: number): Promise<Conversation | null>;
  getMessagesByConversation(conversationId: number): Promise<Message[]>;
  createConversation(title: string): Promise<Conversation>;
  deleteConversation(id: number): Promise<void>;
  createMessage(conversationId: number, role: string, content: string): Promise<Message>;
}

class ChatStorage implements IChatStorage {
  async getAllConversations(): Promise<Conversation[]> {
    const result = await query<Conversation>(
      `SELECT id, title, created_at, updated_at
       FROM chat_conversations
       ORDER BY updated_at DESC`
    );
    return result.rows;
  }

  async getConversation(id: number): Promise<Conversation | null> {
    const result = await query<Conversation>(
      `SELECT id, title, created_at, updated_at
       FROM chat_conversations
       WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async getMessagesByConversation(conversationId: number): Promise<Message[]> {
    const result = await query<Message>(
      `SELECT id, conversation_id, role, content, created_at
       FROM chat_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [conversationId]
    );
    return result.rows;
  }

  async createConversation(title: string): Promise<Conversation> {
    const result = await query<Conversation>(
      `INSERT INTO chat_conversations (title, created_at, updated_at)
       VALUES ($1, NOW(), NOW())
       RETURNING id, title, created_at, updated_at`,
      [title]
    );
    return result.rows[0];
  }

  async deleteConversation(id: number): Promise<void> {
    await query(
      `DELETE FROM chat_messages WHERE conversation_id = $1`,
      [id]
    );
    await query(
      `DELETE FROM chat_conversations WHERE id = $1`,
      [id]
    );
  }

  async createMessage(conversationId: number, role: string, content: string): Promise<Message> {
    const result = await query<Message>(
      `INSERT INTO chat_messages (conversation_id, role, content, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, conversation_id, role, content, created_at`,
      [conversationId, role, content]
    );
    await query(
      `UPDATE chat_conversations SET updated_at = NOW() WHERE id = $1`,
      [conversationId]
    );
    return result.rows[0];
  }
}

export const chatStorage: IChatStorage = new ChatStorage();
