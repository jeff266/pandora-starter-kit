import { Badge } from "@/components/ui/badge";

interface SkillTagProps {
  skillName: string;
  variant?: "default" | "secondary" | "outline";
  className?: string;
}

export function SkillTag({ skillName, variant = "secondary", className }: SkillTagProps) {
  return (
    <Badge variant={variant} className={`font-mono text-xs ${className || ""}`}>
      {skillName}
    </Badge>
  );
}
