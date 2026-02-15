import React from 'react';

interface TimeAgoProps {
  date: string | Date;
}

export default function TimeAgo({ date }: TimeAgoProps) {
  const getTimeAgo = (d: string | Date): string => {
    const now = Date.now();
    const then = new Date(d).getTime();
    const diff = now - then;

    if (isNaN(then)) return '--';

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  };

  return <span>{getTimeAgo(date)}</span>;
}
