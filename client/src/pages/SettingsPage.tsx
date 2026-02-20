import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { colors, fonts } from '../styles/theme';
import { useWorkspace } from '../context/WorkspaceContext';
import SettingsNav from '../components/settings/SettingsNav';
import ProfileTab from '../components/settings/ProfileTab';
import SecurityTab from '../components/settings/SecurityTab';
import PreferencesTab from '../components/settings/PreferencesTab';
import WorkspacesTab from '../components/settings/WorkspacesTab';
import MembersTab from '../components/settings/MembersTab';
import RolesTab from '../components/settings/RolesTab';
import FeaturesTab from '../components/settings/FeaturesTab';
import BillingTab from '../components/settings/BillingTab';

type SettingsTab = 'profile' | 'security' | 'preferences' | 'workspaces' | 'members' | 'roles' | 'features' | 'billing';

const adminTabs: SettingsTab[] = ['members', 'roles', 'features', 'billing'];

export default function SettingsPage() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspace();

  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // Check if user is admin in current workspace
    // For now, check if role is 'admin' - this should be enhanced with proper permission check
    const userIsAdmin = currentWorkspace?.role?.toLowerCase() === 'admin';
    setIsAdmin(userIsAdmin);
  }, [currentWorkspace]);

  useEffect(() => {
    // Set active tab from URL param or default to profile
    if (tab && isValidTab(tab)) {
      setActiveTab(tab as SettingsTab);
    } else if (!tab) {
      navigate('/settings/profile', { replace: true });
    }
  }, [tab, navigate]);

  const isValidTab = (tabKey: string): boolean => {
    const validTabs: SettingsTab[] = ['profile', 'security', 'preferences', 'workspaces', 'members', 'roles', 'features', 'billing'];
    return validTabs.includes(tabKey as SettingsTab);
  };

  const handleTabChange = (tabKey: string) => {
    // Don't allow non-admins to access admin tabs
    if (adminTabs.includes(tabKey as SettingsTab) && !isAdmin) {
      return;
    }
    setActiveTab(tabKey as SettingsTab);
    navigate(`/settings/${tabKey}`);
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'profile':
        return <ProfileTab />;
      case 'security':
        return <SecurityTab />;
      case 'preferences':
        return <PreferencesTab />;
      case 'workspaces':
        return <WorkspacesTab />;
      case 'members':
        return isAdmin ? <MembersTab /> : null;
      case 'roles':
        return isAdmin ? <RolesTab /> : null;
      case 'features':
        return isAdmin ? <FeaturesTab /> : null;
      case 'billing':
        return isAdmin ? <BillingTab /> : null;
      default:
        return <ProfileTab />;
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100%',
        fontFamily: fonts.sans,
        background: colors.bg,
      }}
      className="settings-container"
    >
      <SettingsNav
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isAdmin={isAdmin}
      />

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '32px 40px',
        }}
        className="settings-content"
      >
        {renderTabContent()}
      </div>

      <style>{`
        @media (max-width: 768px) {
          .settings-container {
            flex-direction: column !important;
          }
          .settings-content {
            padding: 24px 16px !important;
          }
        }
      `}</style>
    </div>
  );
}

// Placeholder component for tabs - will be replaced in subsequent prompts
function PlaceholderTab({ title }: { title: string }) {
  return (
    <div
      style={{
        maxWidth: 800,
      }}
    >
      <h1
        style={{
          fontSize: 24,
          fontWeight: 600,
          color: colors.text,
          marginBottom: 8,
          fontFamily: fonts.sans,
        }}
      >
        {title}
      </h1>
      <p
        style={{
          fontSize: 14,
          color: colors.textSecondary,
          marginBottom: 32,
        }}
      >
        {title} settings will be displayed here.
      </p>

      <div
        style={{
          padding: 40,
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 48,
            marginBottom: 16,
            opacity: 0.3,
          }}
        >
          ⚙️
        </div>
        <p
          style={{
            fontSize: 14,
            color: colors.textMuted,
            fontFamily: fonts.sans,
          }}
        >
          {title} content coming soon
        </p>
      </div>
    </div>
  );
}
