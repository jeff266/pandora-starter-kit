export interface ExportConfig {
  format: 'pdf' | 'docx' | 'pptx';
  audience: 'internal' | 'client';
  included_sections: string[];
  prepared_by: string;
  for_company: string;
  anonymize: boolean;
  link_target: 'hubspot' | 'command_center';
  include_actions: boolean;
}
