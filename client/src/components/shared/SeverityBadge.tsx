import { Badge } from "@/components/ui/badge";

export type Severity = "critical" | "high" | "medium" | "low";

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
}

const severityConfig = {
  critical: {
    label: "Critical",
    className: "bg-red-500 text-white hover:bg-red-600",
  },
  high: {
    label: "High",
    className: "bg-orange-500 text-white hover:bg-orange-600",
  },
  medium: {
    label: "Medium",
    className: "bg-yellow-500 text-white hover:bg-yellow-600",
  },
  low: {
    label: "Low",
    className: "bg-blue-500 text-white hover:bg-blue-600",
  },
};

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const config = severityConfig[severity];
  return (
    <Badge className={`${config.className} ${className || ""}`}>
      {config.label}
    </Badge>
  );
}
