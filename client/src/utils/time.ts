/**
 * Convert a date string to relative time format
 * @param dateString ISO date string
 * @returns Formatted relative time string
 */
export function timeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  // For older dates, show month + day
  const currentYear = now.getFullYear();
  const dateYear = date.getFullYear();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthDay = `${months[date.getMonth()]} ${date.getDate()}`;

  // Include year if different from current year
  return dateYear === currentYear ? monthDay : `${monthDay}, ${dateYear}`;
}
