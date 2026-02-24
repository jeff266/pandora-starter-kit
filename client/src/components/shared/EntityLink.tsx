import { Link } from "wouter";

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
      <a className={`text-blue-600 hover:text-blue-800 hover:underline ${className || ""}`}>
        {name}
      </a>
    </Link>
  );
}
