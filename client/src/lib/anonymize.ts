const FAKE_COMPANIES = [
  'Meridian Analytics', 'Vertex Health', 'Lumina Software', 'Forge AI',
  'Catalyst Cloud', 'Beacon Data', 'Prism Robotics', 'Summit Dynamics',
  'Atlas Platform', 'Helix Systems', 'Nova Therapeutics', 'Orbit Labs',
  'Cascade Networks', 'Pinnacle AI', 'Vanguard Tech', 'Stratos IoT',
  'Ember Solutions', 'Zenith Ops', 'Crestline SaaS', 'Ironwood Digital',
  'Thrive Biotech', 'Horizon Fintech', 'Keystone Logic', 'Northstar DevOps',
  'Cobalt Security', 'Evergreen CRM', 'Redwood Analytics', 'Sterling Health',
  'Quantum Bridge', 'Elevate Partners', 'Apex Consulting', 'Silverline Corp',
];

const FAKE_FIRST_NAMES = [
  'Alex', 'Jordan', 'Morgan', 'Casey', 'Riley', 'Taylor',
  'Drew', 'Jamie', 'Quinn', 'Avery', 'Cameron', 'Reese',
  'Sage', 'Parker', 'Blake', 'Hayden', 'Dakota', 'Rowan',
  'Emery', 'Finley', 'Kendall', 'Skyler', 'Marley', 'Peyton',
];

const FAKE_LAST_NAMES = [
  'Chen', 'Patel', 'Williams', 'Torres', 'Kim', 'Okafor',
  'Nakamura', 'Singh', 'Andersen', 'Ruiz', 'Foster', 'Chang',
  'Mitchell', 'Bergman', 'Novak', 'Reeves', 'Morales', 'Sullivan',
  'Kapoor', 'Lindgren', 'Hoffman', 'Vasquez', 'Oduya', 'Ramirez',
];

const DEAL_SUFFIXES = [
  'Enterprise Expansion', 'Platform Migration', 'Annual Renewal',
  'Pilot Program', 'Team Rollout', 'Security Upgrade',
  'Analytics Suite', 'API Integration', 'Data Migration',
  'Compliance Package', 'Premium Tier', 'Multi-Region Deploy',
];

class Anonymizer {
  mappings: Map<string, string> = new Map();
  private seed: number;

  constructor() {
    this.seed = Date.now();
  }

  reset() {
    this.mappings.clear();
    this.seed = Date.now();
  }

  private pick(input: string, options: string[]): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    hash = (hash + this.seed) | 0;
    return options[Math.abs(hash) % options.length];
  }

  anonymizeCompany(real: string): string {
    if (!real) return real;
    if (this.mappings.has(`co:${real}`)) return this.mappings.get(`co:${real}`)!;
    const fake = this.pick(real, FAKE_COMPANIES);
    this.mappings.set(`co:${real}`, fake);
    return fake;
  }

  anonymizePerson(real: string): string {
    if (!real) return real;
    if (this.mappings.has(`pn:${real}`)) return this.mappings.get(`pn:${real}`)!;
    const firstName = this.pick(real + 'f', FAKE_FIRST_NAMES);
    const lastName = this.pick(real + 'l', FAKE_LAST_NAMES);
    const fake = `${firstName} ${lastName}`;
    this.mappings.set(`pn:${real}`, fake);
    return fake;
  }

  anonymizeEmail(real: string): string {
    if (!real) return real;
    if (this.mappings.has(`em:${real}`)) return this.mappings.get(`em:${real}`)!;
    const [localPart, domain] = real.split('@');
    const company = this.anonymizeCompany(domain?.split('.')[0] || 'company');
    const person = this.anonymizePerson(localPart || 'user');
    const fake = `${person.split(' ')[0].toLowerCase()}@${company.toLowerCase().replace(/\s+/g, '')}.com`;
    this.mappings.set(`em:${real}`, fake);
    return fake;
  }

  anonymizeDeal(real: string): string {
    if (!real) return real;
    if (this.mappings.has(`dl:${real}`)) return this.mappings.get(`dl:${real}`)!;
    const suffix = this.pick(real, DEAL_SUFFIXES);
    const fake = `${this.pick(real, FAKE_COMPANIES)} — ${suffix}`;
    this.mappings.set(`dl:${real}`, fake);
    return fake;
  }

  anonymizeAmount(real: number): number {
    if (!real && real !== 0) return real;
    const digit = this.pick(String(real), ['0','1','2','3','4','5','6','7','8','9']);
    const factor = 0.6 + (Math.abs(digit.charCodeAt(0)) % 10) / 10 * 0.8;
    return Math.round(real * factor / 1000) * 1000;
  }

  anonymizeWorkspace(real: string): string {
    if (!real) return real;
    if (this.mappings.has(`ws:${real}`)) return this.mappings.get(`ws:${real}`)!;
    const fake = this.pick(real, FAKE_COMPANIES);
    this.mappings.set(`ws:${real}`, fake);
    return fake;
  }

  anonymizeText(text: string): string {
    if (!text) return text;
    let result = text;
    for (const [key, fake] of this.mappings.entries()) {
      const real = key.split(':').slice(1).join(':');
      if (real && real.length > 2) {
        result = result.replaceAll(real, fake);
      }
    }
    return result;
  }
}

export const anonymizer = new Anonymizer();
