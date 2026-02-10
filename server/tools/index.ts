export {
  queryDeals,
  getDeal,
  getDealsByStage,
  getStaleDeals,
  getDealsClosingInRange,
  getPipelineSummary,
  type Deal,
  type DealFilters,
} from './deal-query.js';

export {
  queryContacts,
  getContact,
  getContactsForDeal,
  getStakeholderMap,
  type Contact,
  type ContactFilters,
} from './contact-query.js';

export {
  queryAccounts,
  getAccount,
  getAccountHealth,
  type Account,
  type AccountFilters,
} from './account-query.js';

export {
  queryActivities,
  getActivityTimeline,
  getActivitySummary,
  type Activity,
  type ActivityFilters,
} from './activity-query.js';

export {
  queryConversations,
  getConversation,
  getRecentCallsForDeal,
  getCallInsights,
  type Conversation,
  type ConversationFilters,
} from './conversation-query.js';

export {
  queryTasks,
  getOverdueTasks,
  getTaskSummary,
  type Task,
  type TaskFilters,
} from './task-query.js';

export {
  queryDocuments,
  getDocument,
  getDocumentsForDeal,
  type Document,
  type DocumentFilters,
} from './document-query.js';
