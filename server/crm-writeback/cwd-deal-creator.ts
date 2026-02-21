/**
 * CWD Deal Creator
 *
 * Creates deals in HubSpot/Salesforce from Conversations Without Deals
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { getConnectorCredentials } from '../lib/credential-store.js';

const logger = createLogger('CWDDealCreator');

interface NewContact {
  name: string;
  email: string;
  title?: string;
}

interface CreateDealRequest {
  workspaceId: string;
  crmType: 'hubspot' | 'salesforce';
  dealName: string;
  amount?: number;
  stage: string;
  closeDate: string;
  ownerEmail: string;
  pipelineId?: string;
  accountId: string;
  contactsToAssociate: string[];
  contactsToCreate: NewContact[];
  notes: string;
  conversationId: string;
}

export async function createDealFromCWD(request: CreateDealRequest): Promise<{
  deal_crm_id: string;
  deal_url: string;
  contacts_created: number;
  contacts_associated: number;
}> {
  if (request.crmType === 'hubspot') {
    return createHubSpotDeal(request);
  } else {
    return createSalesforceDeal(request);
  }
}

async function createHubSpotDeal(request: CreateDealRequest): Promise<any> {
  const creds = await getConnectorCredentials(request.workspaceId, 'hubspot');
  if (!creds?.accessToken) {
    throw new Error('HubSpot not connected');
  }

  // Get account's HubSpot company ID
  const accountResult = await query(
    'SELECT source_id FROM accounts WHERE id = $1 AND workspace_id = $2',
    [request.accountId, request.workspaceId]
  );

  const companyId = accountResult.rows[0]?.source_id;
  if (!companyId) {
    throw new Error('Account not found in HubSpot');
  }

  // Create deal
  const dealProperties: Record<string, string> = {
    dealname: request.dealName,
    dealstage: request.stage,
    closedate: new Date(request.closeDate).getTime().toString(),
  };

  if (request.amount) {
    dealProperties.amount = request.amount.toString();
  }

  if (request.pipelineId) {
    dealProperties.pipeline = request.pipelineId;
  }

  // Find owner by email
  const ownerResponse = await fetch(
    `https://api.hubapi.com/crm/v3/owners/?email=${encodeURIComponent(request.ownerEmail)}`,
    {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (ownerResponse.ok) {
    const ownerData = await ownerResponse.json() as { results: any[] };
    if (ownerData.results.length > 0) {
      dealProperties.hubspot_owner_id = ownerData.results[0].id;
    }
  }

  const dealPayload: any = { properties: dealProperties };

  // Associate with company
  dealPayload.associations = [
    {
      to: { id: companyId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }], // deal to company
    },
  ];

  const dealResponse = await fetch('https://api.hubapi.com/crm/v3/objects/deals', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(dealPayload),
  });

  if (!dealResponse.ok) {
    const errorText = await dealResponse.text();
    throw new Error(`HubSpot deal creation failed: ${errorText}`);
  }

  const dealData = await dealResponse.json() as { id: string };
  const dealId = dealData.id;

  // Create new contacts
  let contactsCreated = 0;
  for (const contact of request.contactsToCreate) {
    try {
      const contactProperties: Record<string, string> = {
        firstname: contact.name.split(' ')[0] || contact.name,
        lastname: contact.name.split(' ').slice(1).join(' ') || '',
        email: contact.email,
      };

      if (contact.title) {
        contactProperties.jobtitle = contact.title;
      }

      const contactResponse = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: contactProperties,
          associations: [
            {
              to: { id: dealId },
              types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 4 }], // contact to deal
            },
            {
              to: { id: companyId },
              types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }], // contact to company
            },
          ],
        }),
      });

      if (contactResponse.ok) {
        contactsCreated++;
      }
    } catch (err) {
      logger.error('Failed to create contact', err as Error, { email: contact.email });
    }
  }

  // Associate existing contacts
  let contactsAssociated = 0;
  for (const contactId of request.contactsToAssociate) {
    try {
      await fetch(
        `https://api.hubapi.com/crm/v3/objects/deals/${dealId}/associations/contact/${contactId}/4`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${creds.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      contactsAssociated++;
    } catch (err) {
      logger.error('Failed to associate contact', err as Error, { contactId });
    }
  }

  // Create note
  try {
    await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          hs_note_body: request.notes,
        },
        associations: [
          {
            to: { id: dealId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }],
          },
        ],
      }),
    });
  } catch (err) {
    // Non-fatal
    logger.error('Failed to create note', err as Error);
  }

  return {
    deal_crm_id: dealId,
    deal_url: `https://app.hubspot.com/contacts/${creds.portalId || ''}/deal/${dealId}`,
    contacts_created: contactsCreated,
    contacts_associated: contactsAssociated,
  };
}

async function createSalesforceDeal(request: CreateDealRequest): Promise<any> {
  const creds = await getConnectorCredentials(request.workspaceId, 'salesforce');
  if (!creds?.accessToken || !creds?.instanceUrl) {
    throw new Error('Salesforce not connected');
  }

  // Get account's Salesforce ID
  const accountResult = await query(
    'SELECT source_id FROM accounts WHERE id = $1 AND workspace_id = $2',
    [request.accountId, request.workspaceId]
  );

  const accountId = accountResult.rows[0]?.source_id;
  if (!accountId) {
    throw new Error('Account not found in Salesforce');
  }

  // Create opportunity
  const oppData: any = {
    Name: request.dealName,
    StageName: request.stage,
    CloseDate: request.closeDate,
    AccountId: accountId,
  };

  if (request.amount) {
    oppData.Amount = request.amount;
  }

  const oppResponse = await fetch(
    `${creds.instanceUrl}/services/data/v62.0/sobjects/Opportunity`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(oppData),
    }
  );

  if (!oppResponse.ok) {
    const errorText = await oppResponse.text();
    throw new Error(`Salesforce opportunity creation failed: ${errorText}`);
  }

  const oppResult = await oppResponse.json() as { id: string };
  const oppId = oppResult.id;

  // Create new contacts and link via OpportunityContactRole
  let contactsCreated = 0;
  for (const contact of request.contactsToCreate) {
    try {
      const contactData: any = {
        FirstName: contact.name.split(' ')[0] || contact.name,
        LastName: contact.name.split(' ').slice(1).join(' ') || 'Unknown',
        Email: contact.email,
        AccountId: accountId,
      };

      if (contact.title) {
        contactData.Title = contact.title;
      }

      const contactResponse = await fetch(
        `${creds.instanceUrl}/services/data/v62.0/sobjects/Contact`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${creds.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(contactData),
        }
      );

      if (contactResponse.ok) {
        const contactResult = await contactResponse.json() as { id: string };

        // Create OpportunityContactRole
        await fetch(
          `${creds.instanceUrl}/services/data/v62.0/sobjects/OpportunityContactRole`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${creds.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              OpportunityId: oppId,
              ContactId: contactResult.id,
              IsPrimary: contactsCreated === 0,
            }),
          }
        );

        contactsCreated++;
      }
    } catch (err) {
      logger.error('Failed to create contact', err as Error, { email: contact.email });
    }
  }

  // Associate existing contacts
  let contactsAssociated = 0;
  for (const contactId of request.contactsToAssociate) {
    try {
      await fetch(
        `${creds.instanceUrl}/services/data/v62.0/sobjects/OpportunityContactRole`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${creds.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            OpportunityId: oppId,
            ContactId: contactId,
            IsPrimary: contactsCreated === 0 && contactsAssociated === 0,
          }),
        }
      );
      contactsAssociated++;
    } catch (err) {
      logger.error('Failed to associate contact', err as Error, { contactId });
    }
  }

  // Create task as audit note
  try {
    await fetch(`${creds.instanceUrl}/services/data/v62.0/sobjects/Task`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        Subject: 'Created by Pandora',
        Description: request.notes,
        ActivityDate: new Date().toISOString().split('T')[0],
        WhatId: oppId,
      }),
    });
  } catch (err) {
    // Non-fatal
    logger.error('Failed to create task', err as Error);
  }

  return {
    deal_crm_id: oppId,
    deal_url: `${creds.instanceUrl}/lightning/r/Opportunity/${oppId}/view`,
    contacts_created: contactsCreated,
    contacts_associated: contactsAssociated,
  };
}
