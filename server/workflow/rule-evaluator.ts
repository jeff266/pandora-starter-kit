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
   * Split a comma-separated argument string while respecting nested
   * parentheses and single-quoted strings.
   * e.g. "a, 'b,c', fn(x, y)" → ["a", "'b,c'", "fn(x, y)"]
   */
  private splitArgs(str: string): string[] {
    const args: string[] = [];
    let depth = 0;
    let inQuote = false;
    let current = '';

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === "'" && !inQuote) {
        inQuote = true;
        current += ch;
      } else if (ch === "'" && inQuote) {
        inQuote = false;
        current += ch;
      } else if (inQuote) {
        current += ch;
      } else if (ch === '(') {
        depth++;
        current += ch;
      } else if (ch === ')') {
        depth--;
        current += ch;
      } else if (ch === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) args.push(current.trim());
    return args;
  }

  /**
   * Resolve value expressions.
   *
   * Supported patterns (evaluated in order):
   *   upper(expr)                      — uppercase string
   *   lower(expr)                      — lowercase string
   *   round(expr, n)                   — round to n decimal places
   *   concat(expr1, expr2, ...)        — join values as strings
   *   if(field op value, true, false)  — conditional (ops: < > <= >= == !=)
   *   today+Nd / today-Nd              — date offset (YYYY-MM-DD)
   *   {{deal.field}}                   — template variable (dot path into context)
   *   field*n / field/n / etc.         — bare-field arithmetic
   *   'literal text'                   — quoted plain string
   */
  resolveValueExpr(expr: string, context: RuleContext): any {
    if (typeof expr !== 'string') {
      return expr;
    }

    const trimmed = expr.trim();

    // 1. Function calls: fnName(args...)
    const fnMatch = trimmed.match(/^([a-z_]\w*)\((.+)\)$/);
    if (fnMatch) {
      const [, fnName, argsStr] = fnMatch;
      const knownFns = ['upper', 'lower', 'round', 'concat', 'if'];
      if (knownFns.includes(fnName)) {
        const args = this.splitArgs(argsStr);

        switch (fnName) {
          case 'upper': {
            const val = this.resolveValueExpr(args[0] ?? '', context);
            return String(val ?? '').toUpperCase();
          }
          case 'lower': {
            const val = this.resolveValueExpr(args[0] ?? '', context);
            return String(val ?? '').toLowerCase();
          }
          case 'round': {
            const val = Number(this.resolveValueExpr(args[0] ?? '0', context));
            const decimals = args[1] !== undefined ? Math.max(0, parseInt(args[1])) : 0;
            return isNaN(val) ? val : Number(val.toFixed(decimals));
          }
          case 'concat': {
            return args
              .map(a => String(this.resolveValueExpr(a, context) ?? ''))
              .join('');
          }
          case 'if': {
            if (args.length < 3) return null;
            const [condArg, trueArg, falseArg] = args;
            // Parse condition: leftExpr op rightExpr
            const condMatch = condArg.match(/^(.+?)\s*(<=|>=|!=|==|<|>)\s*(.+)$/);
            if (!condMatch) {
              // No operator found — treat non-empty resolved value as truthy
              const condVal = this.resolveValueExpr(condArg, context);
              return this.resolveValueExpr(condVal ? trueArg : falseArg, context);
            }
            const [, leftExpr, op, rightExpr] = condMatch;
            const leftVal  = this.resolveValueExpr(leftExpr.trim(), context);
            const rightVal = this.resolveValueExpr(rightExpr.trim(), context);
            const leftNum  = Number(leftVal);
            const rightNum = Number(rightVal);
            let result: boolean;
            switch (op) {
              case '<':  result = leftNum < rightNum; break;
              case '>':  result = leftNum > rightNum; break;
              case '<=': result = leftNum <= rightNum; break;
              case '>=': result = leftNum >= rightNum; break;
              case '==': result = String(leftVal) === String(rightVal); break;
              case '!=': result = String(leftVal) !== String(rightVal); break;
              default:   result = false;
            }
            return this.resolveValueExpr(result ? trueArg : falseArg, context);
          }
        }
      }
    }

    // 2. Date expressions: today+Nd, today-Nd
    const dateMatch = trimmed.match(/^today([+-]\d+)d$/);
    if (dateMatch) {
      const days = parseInt(dateMatch[1]);
      const date = new Date();
      date.setDate(date.getDate() + days);
      return date.toISOString().split('T')[0]; // YYYY-MM-DD
    }

    // 3. Template variables: {{field.path}} — with optional trailing arithmetic
    if (trimmed.includes('{{')) {
      let result = trimmed;
      const matches = trimmed.match(/\{\{(.+?)\}\}/g) || [];
      for (const match of matches) {
        const fieldPath = match.slice(2, -2).trim();
        const value = this.resolveField(fieldPath, context);
        result = result.replace(match, String(value ?? ''));
      }
      // After substitution: if the result looks like `number op number`, evaluate it
      const numArithMatch = result.match(/^(-?\d+(?:\.\d+)?)\s*([*\/])\s*(\d+(?:\.\d+)?)$/);
      if (numArithMatch) {
        const [, a, op, b] = numArithMatch;
        const av = Number(a);
        const bv = Number(b);
        switch (op) {
          case '*': return av * bv;
          case '/': return bv !== 0 ? av / bv : av;
        }
      }
      return result;
    }

    // 4. Bare-field arithmetic: amount*0.9, days_in_stage+5
    const arithMatch = trimmed.match(/^(\w+)([*\/+-])(\d+(?:\.\d+)?)$/);
    if (arithMatch) {
      const [, field, op, num] = arithMatch;
      const fieldValue = Number(this.resolveField(field, context));
      const numValue = Number(num);
      switch (op) {
        case '*': return fieldValue * numValue;
        case '/': return numValue !== 0 ? fieldValue / numValue : fieldValue;
        case '+': return fieldValue + numValue;
        case '-': return fieldValue - numValue;
      }
    }

    // 5. Quoted plain string literal: 'text'
    if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
      return trimmed.slice(1, -1);
    }

    // 6. Return as-is
    return trimmed;
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
