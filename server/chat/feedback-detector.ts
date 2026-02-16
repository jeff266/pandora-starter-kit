export interface FeedbackSignal {
  type: 'confirm' | 'correct' | 'dismiss';
  confidence: number;
}

export function detectFeedback(message: string, hasPreviousResponse: boolean): FeedbackSignal | null {
  if (!hasPreviousResponse) return null;

  const lower = message.toLowerCase().trim();

  const confirmPatterns = [
    /^(that'?s? right|exactly|correct|yes|yeah|yep|confirmed|makes sense|good point)/,
    /^(spot on|nailed it|bingo|precisely)/,
  ];

  const correctionPatterns = [
    /^(actually|no[,.]|that'?s? (wrong|not right|incorrect)|not really)/,
    /^(well[,.]|but |however[,.])/,
    /the (deal|account|rep) is (actually|really)/,
    /you'?re? (missing|wrong|off) (about|on|regarding)/,
  ];

  const dismissalPatterns = [
    /^(i know|already aware|seen this|old news|not important)/,
    /^(skip|next|move on|don'?t care)/,
  ];

  for (const pattern of confirmPatterns) {
    if (pattern.test(lower)) return { type: 'confirm', confidence: 0.8 };
  }
  for (const pattern of correctionPatterns) {
    if (pattern.test(lower)) return { type: 'correct', confidence: 0.7 };
  }
  for (const pattern of dismissalPatterns) {
    if (pattern.test(lower)) return { type: 'dismiss', confidence: 0.6 };
  }

  return null;
}
