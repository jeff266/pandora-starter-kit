import { Link } from "wouter";
import { colors } from '../../styles/theme';

interface EntityLinkProps {
  type: "account" | "deal" | "contact";
  id: string;
  name: string;
  workspaceId: string;
  className?: string;
}

export function EntityLink({ type, id, name, workspaceId, className }: EntityLinkProps) {
  const pathMap = {
    account: `/workspaces/${workspaceId}/accounts/${id}`,
    deal: `/workspaces/${workspaceId}/deals/${id}`,
    contact: `/workspaces/${workspaceId}/contacts/${id}`,
  };

  const path = pathMap[type];

  return (
    <Link href={path}>
      <a
        style={{
          color: colors.accent,
          textDecoration: 'none',
        }}
        className={className}
        onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
        onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
      >
        {name}
      </a>
    </Link>
  );
}
