/**
 * Skill Registry
 *
 * Central registry for all skills in Pandora.
 * Singleton pattern (same as AdapterRegistry).
 *
 * Skills are registered at app startup and can be looked up by ID or category.
 */

import type { SkillDefinition } from './types.js';

export class SkillRegistry {
  private static instance: SkillRegistry;
  private skills: Map<string, SkillDefinition> = new Map();

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): SkillRegistry {
    if (!SkillRegistry.instance) {
      SkillRegistry.instance = new SkillRegistry();
    }
    return SkillRegistry.instance;
  }

  /**
   * Register a skill
   * @throws Error if skill with same ID already registered
   */
  register(skill: SkillDefinition): void {
    if (this.skills.has(skill.id)) {
      throw new Error(`Skill with ID '${skill.id}' is already registered`);
    }
    this.skills.set(skill.id, skill);
    console.log(`[SkillRegistry] Registered ${skill.category} skill: ${skill.id}`);
  }

  /**
   * Get skill by ID
   */
  get(skillId: string): SkillDefinition | undefined {
    return this.skills.get(skillId);
  }

  /**
   * Get all skills in a category
   */
  getByCategory(category: string): SkillDefinition[] {
    return Array.from(this.skills.values()).filter(skill => skill.category === category);
  }

  /**
   * List all skills (summary)
   */
  listAll(): Array<{
    id: string;
    name: string;
    category: string;
    tier: string;
    schedule?: { cron?: string; trigger?: string };
  }> {
    return Array.from(this.skills.values()).map(skill => ({
      id: skill.id,
      name: skill.name,
      category: skill.category,
      tier: skill.tier,
      schedule: skill.schedule,
    }));
  }

  /**
   * Get skills with scheduling configured
   */
  getScheduled(): SkillDefinition[] {
    return Array.from(this.skills.values()).filter(skill => skill.schedule !== undefined);
  }

  /**
   * Check if skill exists
   */
  has(skillId: string): boolean {
    return this.skills.has(skillId);
  }

  /**
   * Unregister a skill (primarily for testing)
   */
  unregister(skillId: string): boolean {
    return this.skills.delete(skillId);
  }

  /**
   * Clear all skills (primarily for testing)
   */
  clear(): void {
    this.skills.clear();
  }

  /**
   * Get registry stats
   */
  getStats(): {
    total: number;
    byCategory: Record<string, number>;
    byTier: Record<string, number>;
    scheduled: number;
  } {
    const byCategory: Record<string, number> = {};
    const byTier: Record<string, number> = {};
    let scheduled = 0;

    for (const skill of this.skills.values()) {
      byCategory[skill.category] = (byCategory[skill.category] || 0) + 1;
      byTier[skill.tier] = (byTier[skill.tier] || 0) + 1;
      if (skill.schedule) scheduled++;
    }

    return {
      total: this.skills.size,
      byCategory,
      byTier,
      scheduled,
    };
  }
}

/**
 * Convenience function to get singleton
 */
export function getSkillRegistry(): SkillRegistry {
  return SkillRegistry.getInstance();
}

/**
 * Register all built-in skills
 * (Called at app startup)
 */
export function registerAllSkills(): void {
  const registry = getSkillRegistry();

  // Import and register skills
  // These will be imported dynamically to avoid circular dependencies
  // For now, skills are registered manually when they're needed
  console.log('[SkillRegistry] Ready to register skills');
}
