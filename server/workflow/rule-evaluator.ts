/**
 * Rule Evaluator
 * Evaluates workflow rule conditions against a context object
 */

export interface ConditionJSON {
  // Simple condition
  field?: string;
  op?: 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'contains' | 'not_null' | 'is_null' | 'in' | 'not_in';
  value?: any;

  // Complex conditions
  and?: ConditionJSON[];
  or?: ConditionJSON[];
}

export interface RuleContext {
  // Finding metadata
  finding?: {
    id: string;
    category: string;
    severity: string;
    title: string;
    summary: string;
    metadata: Record<string, any>;
  };

  // Deal fields
  deal?: Record<string, any>;

  // Skill output
  skill_output?: Record<string, any>;

  // Workspace config
  workspace?: {
    id: string;
    stage_avg_durations?: Record<string, number>;
    [key: string]: any;
  };

  // Trigger info
  trigger?: {
    type: string;
    source_id: string;
  };
}

export class RuleEvaluator {
  /**
   * Evaluate a condition against a context
   */
  evaluate(condition: ConditionJSON, context: RuleContext): boolean {
    // Handle complex conditions
    if (condition.and) {
      return condition.and.every(c => this.evaluate(c, context));
    }

    if (condition.or) {
      return condition.or.some(c => this.evaluate(c, context));
    }

    // Handle simple condition
    if (!condition.field || !condition.op) {
      return true; // Empty condition always passes
    }

    const fieldValue = this.resolveField(condition.field, context);
    return this.evaluateOperator(condition.op, fieldValue, condition.value);
  }

  /**
   * Resolve a field path from context
   * Supports dot notation: "deal.amount", "finding.metadata.stage_age_ratio"
   */
  private resolveField(fieldPath: string, context: RuleContext): any {
    const parts = fieldPath.split('.');
    let value: any = context;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return null;
      }
      value = value[part];
    }

    return value;
  }

  /**
   * Evaluate an operator against a field value and comparison value
   */
  private evaluateOperator(op: string, fieldValue: any, compareValue: any): boolean {
    switch (op) {
      case 'gt':
        return Number(fieldValue) > Number(compareValue);

      case 'gte':
        return Number(fieldValue) >= Number(compareValue);

      case 'lt':
        return Number(fieldValue) < Number(compareValue);

      case 'lte':
        return Number(fieldValue) <= Number(compareValue);

      case 'eq':
        return fieldValue === compareValue;

      case 'contains':
        if (typeof fieldValue !== 'string') return false;
        return fieldValue.toLowerCase().includes(String(compareValue).toLowerCase());

      case 'not_null':
        return fieldValue !== null && fieldValue !== undefined && fieldValue !== '';

      case 'is_null':
        return fieldValue === null || fieldValue === undefined || fieldValue === '';

      case 'in':
        if (!Array.isArray(compareValue)) return false;
        return compareValue.includes(fieldValue);

      case 'not_in':
        if (!Array.isArray(compareValue)) return false;
        return !compareValue.includes(fieldValue);

      default:
        return false;
    }
  }

  /**
   * Resolve value expressions like 'today+3d', '{{deal.owner_email}}', 'stage_avg*2'
   */
  resolveValueExpr(expr: string, context: RuleContext): any {
    if (typeof expr !== 'string') {
      return expr;
    }

    // Handle date expressions: today+Nd, today-Nd
    const dateMatch = expr.match(/^today([+-]\d+)d$/);
    if (dateMatch) {
      const days = parseInt(dateMatch[1]);
      const date = new Date();
      date.setDate(date.getDate() + days);
      return date.toISOString().split('T')[0]; // YYYY-MM-DD
    }

    // Handle template variables: {{field.path}}
    const templateMatch = expr.match(/\{\{(.+?)\}\}/g);
    if (templateMatch) {
      let result = expr;
      for (const match of templateMatch) {
        const fieldPath = match.slice(2, -2).trim();
        const value = this.resolveField(fieldPath, context);
        result = result.replace(match, String(value ?? ''));
      }
      return result;
    }

    // Handle arithmetic expressions: stage_avg*2
    const arithMatch = expr.match(/^(\w+)([*\/+-])(\d+(?:\.\d+)?)$/);
    if (arithMatch) {
      const [, field, op, num] = arithMatch;
      const fieldValue = Number(this.resolveField(field, context));
      const numValue = Number(num);

      switch (op) {
        case '*': return fieldValue * numValue;
        case '/': return fieldValue / numValue;
        case '+': return fieldValue + numValue;
        case '-': return fieldValue - numValue;
      }
    }

    // Return as-is if no pattern matches
    return expr;
  }

  /**
   * Validate a condition structure
   */
  validateCondition(condition: ConditionJSON): { valid: boolean; error?: string } {
    if (condition.and) {
      if (!Array.isArray(condition.and)) {
        return { valid: false, error: '"and" must be an array' };
      }
      for (const c of condition.and) {
        const result = this.validateCondition(c);
        if (!result.valid) return result;
      }
      return { valid: true };
    }

    if (condition.or) {
      if (!Array.isArray(condition.or)) {
        return { valid: false, error: '"or" must be an array' };
      }
      for (const c of condition.or) {
        const result = this.validateCondition(c);
        if (!result.valid) return result;
      }
      return { valid: true };
    }

    if (!condition.field && !condition.op) {
      return { valid: true }; // Empty condition is valid
    }

    if (!condition.field) {
      return { valid: false, error: 'Condition must have "field"' };
    }

    if (!condition.op) {
      return { valid: false, error: 'Condition must have "op"' };
    }

    const validOps = ['gt', 'lt', 'eq', 'gte', 'lte', 'contains', 'not_null', 'is_null', 'in', 'not_in'];
    if (!validOps.includes(condition.op)) {
      return { valid: false, error: `Invalid operator: ${condition.op}` };
    }

    return { valid: true };
  }
}
