export function formatCurrency(value: number | string | null | undefined): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}k`;
  return `$${num.toFixed(0)}`;
}

export function formatNumber(value: number | string | null | undefined): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString();
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '--';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString();
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '--';
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

export function severityColor(severity: string): string {
  switch (severity) {
    case 'act': return '#ef4444';
    case 'watch': return '#eab308';
    case 'notable': return '#3b82f6';
    default: return '#5a6578';
  }
}

export function severityBg(severity: string): string {
  switch (severity) {
    case 'act': return 'rgba(239,68,68,0.1)';
    case 'watch': return 'rgba(234,179,8,0.1)';
    case 'notable': return 'rgba(59,130,246,0.12)';
    default: return 'rgba(90,101,120,0.1)';
  }
}

export function formatSchedule(schedule: any): string {
  if (!schedule) return 'On demand';
  if (typeof schedule === 'string') {
    if (/^\d/.test(schedule)) return humanizeCron(schedule);
    return schedule;
  }
  if (typeof schedule === 'object') {
    if (schedule.description) return schedule.description;
    if (schedule.trigger === 'on_demand') return 'On demand';
    if (schedule.trigger === 'on_sync') return 'After each sync';
    if (schedule.cron) return humanizeCron(schedule.cron);
    if (schedule.trigger) return String(schedule.trigger);
    return 'Scheduled';
  }
  return String(schedule);
}

function humanizeCron(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length < 5) return cron;
  const [min, hour, dom, , dow] = parts;
  const h = parseInt(hour);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const time = `${h12}${min !== '0' ? ':' + min.padStart(2, '0') : ''} ${ampm}`;

  const dayNames: Record<string, string> = { '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat' };

  if (dow === '*' && dom === '*') return `Daily ${time}`;
  if (dow === '*' && dom !== '*') {
    const days = dom.split(',');
    if (days.length === 1) return `${ordinal(parseInt(days[0]))} of month ${time}`;
    return `${days.map(d => ordinal(parseInt(d))).join(', ')} of month ${time}`;
  }
  if (dow !== '*') {
    const days = dow.split(',').map(d => dayNames[d] || d);
    if (days.length === 1) return `${days[0]}s ${time}`;
    return `${days.join(', ')} ${time}`;
  }
  return cron;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
