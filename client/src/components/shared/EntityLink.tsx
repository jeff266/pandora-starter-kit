import React from 'react';
import { useNavigate } from 'react-router-dom';
import { colors } from '../../styles/theme';

interface EntityLinkProps {
  type: "account" | "deal" | "contact";
  id: string;
  name: string;
  workspaceId: string;
  className?: string;
  style?: React.CSSProperties;
}

export function EntityLink({ type, id, name, workspaceId, className, style }: EntityLinkProps) {
  const navigate = useNavigate();

  const pathMap = {
    account: `/workspaces/${workspaceId}/accounts/${id}`,
    deal: `/workspaces/${workspaceId}/deals/${id}`,
    contact: `/workspaces/${workspaceId}/contacts/${id}`,
  };

  const path = pathMap[type];

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(path);
  };

  return (
    <a
      href={path}
      onClick={handleClick}
      style={{
        color: colors.accent,
        textDecoration: 'none',
        cursor: 'pointer',
        ...style,
      }}
      className={className}
      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
    >
      {name}
    </a>
  );
}
