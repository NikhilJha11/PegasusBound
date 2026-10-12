import type { Bundle, ZObject } from '../lib/types';
import { api, listData, pruneEmpty } from '../lib/client';

const CONTACT_SAMPLE = {
  id: '7b6c1f2a-0000-0000-0000-000000000000',
  email: 'lead@example.com',
  first_name: 'Sam',
  last_name: 'Rivera',
  company: 'Example Co',
  phone: '+15551234567',
  subscribed: true,
  custom_fields: { title: 'Head of Growth' },
  categories: [],
  created_at: '2026-06-28T12:00:00Z',
  updated_at: '2026-06-28T12:00:00Z',
};

const CONTACT_OUTPUT = [
  { key: 'id', label: 'Contact ID' },
  { key: 'email', label: 'Email' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'company', label: 'Company' },
  { key: 'phone', label: 'Phone' },
  { key: 'subscribed', type: 'boolean', label: 'Subscribed' },
  { key: 'created_at', label: 'Created at' },
  { key: 'updated_at', label: 'Updated at' },
];

// `sort_by` must be a bare, whitelisted column (created_at | updated_at | ...);
// direction defaults to DESC, so omitting `reverse` returns the most recent
// rows first. Dedupe is by the returned `id`.
const searchContacts =
  (sortBy: 'created_at' | 'updated_at') =>
  async (z: ZObject): Promise<any[]> => {
    const response = await z.request({
      url: api('/contacts/search'),
      method: 'POST',
      params: { limit: 100 },
      body: { sort_by: sortBy },
    });
    return listData(response);
  };

const newContact = {
  key: 'newContact',
  noun: 'Contact',
  display: {
    label: 'New Contact',
    description: 'Triggers when a contact is added to your Pegasusbound workspace.',
  },
  operation: {
    perform: (z: ZObject) => searchContacts('created_at')(z),
    sample: CONTACT_SAMPLE,
    outputFields: CONTACT_OUTPUT,
  },
};

const newOrUpdatedContact = {
  key: 'newOrUpdatedContact',
  noun: 'Contact',
  display: {
    label: 'New or Updated Contact',
    description:
      'Triggers when a contact is created or changed. The real contact id is in the contact_id field; the dedupe id combines it with the update time so edits re-fire.',
  },
  operation: {
    perform: async (z: ZObject): Promise<any[]> => {
      const items = await searchContacts('updated_at')(z);
      return items.map((c) => ({
        ...c,
        contact_id: c.id,
        id: `${c.id}:${c.updated_at}`,
      }));
    },
    sample: { ...CONTACT_SAMPLE, contact_id: CONTACT_SAMPLE.id },
    outputFields: [{ key: 'contact_id', label: 'Contact ID' }, ...CONTACT_OUTPUT],
  },
};

const contactIdField = {
  key: 'contact_id',
  label: 'Contact',
  type: 'string',
  required: true,
  dynamic: 'contactList.id.name',
};

const createContact = {
  key: 'createContact',
  noun: 'Contact',
  display: {
    label: 'Create or Update Contact',
    description:
      'Adds a contact (or updates the existing one with the same email) and optionally enrolls it into campaigns. Custom fields merge by key.',
  },
  operation: {
    inputFields: [
      { key: 'email', label: 'Email', type: 'string', required: true },
      { key: 'first_name', label: 'First name', type: 'string' },
      { key: 'last_name', label: 'Last name', type: 'string' },
      { key: 'company', label: 'Company', type: 'string' },
      { key: 'phone', label: 'Phone', type: 'string' },
      {
        key: 'campaigns',
        label: 'Enroll in campaigns',
        type: 'string',
        list: true,
        dynamic: 'campaignList.id.name',
        helpText: 'Campaigns to enroll this contact into as a lead.',
      },
      {
        key: 'categories',
        label: 'Category IDs',
        type: 'string',
        list: true,
        helpText: 'Contact category UUIDs to assign.',
      },
      {
        key: 'custom_fields',
        label: 'Custom fields',
        dict: true,
        helpText: 'Free-form key/value attributes stored on the contact.',
      },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const contact = pruneEmpty({
        email: bundle.inputData.email,
        first_name: bundle.inputData.first_name,
        last_name: bundle.inputData.last_name,
        company: bundle.inputData.company,
        phone: bundle.inputData.phone,
        campaigns: bundle.inputData.campaigns,
        categories: bundle.inputData.categories,
        custom_fields: bundle.inputData.custom_fields,
      });
      const response = await z.request({
        url: api('/contacts'),
        method: 'POST',
        body: [contact],
      });
      return Array.isArray(response.data) ? response.data[0] : response.data;
    },
    sample: CONTACT_SAMPLE,
  },
};

const updateContact = {
  key: 'updateContact',
  noun: 'Contact',
  display: {
    label: 'Update Contact',
    description: 'Updates an existing contact by ID. Email cannot be changed.',
  },
  operation: {
    inputFields: [
      contactIdField,
      { key: 'first_name', label: 'First name', type: 'string' },
      { key: 'last_name', label: 'Last name', type: 'string' },
      { key: 'company', label: 'Company', type: 'string' },
      { key: 'phone', label: 'Phone', type: 'string' },
      { key: 'subscribed', label: 'Subscribed', type: 'boolean' },
      {
        key: 'campaigns',
        label: 'Set campaigns',
        type: 'string',
        list: true,
        dynamic: 'campaignList.id.name',
        helpText: 'Replaces the full set of campaigns this contact belongs to.',
      },
      { key: 'custom_fields', label: 'Custom fields', dict: true },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const body = pruneEmpty({
        first_name: bundle.inputData.first_name,
        last_name: bundle.inputData.last_name,
        company: bundle.inputData.company,
        phone: bundle.inputData.phone,
        subscribed: bundle.inputData.subscribed,
        campaigns: bundle.inputData.campaigns,
        custom_fields: bundle.inputData.custom_fields,
      });
      const response = await z.request({
        url: api(`/contacts/${bundle.inputData.contact_id}`),
        method: 'PATCH',
        body,
      });
      return response.data;
    },
    sample: CONTACT_SAMPLE,
  },
};

const deleteContact = {
  key: 'deleteContact',
  noun: 'Contact',
  display: {
    label: 'Delete Contact',
    description: 'Permanently deletes a contact by ID.',
  },
  operation: {
    inputFields: [contactIdField],
    perform: async (z: ZObject, bundle: Bundle) => {
      await z.request({
        url: api(`/contacts/${bundle.inputData.contact_id}`),
        method: 'DELETE',
      });
      return { id: bundle.inputData.contact_id, success: true };
    },
    sample: { id: CONTACT_SAMPLE.id, success: true },
  },
};

const addContactToCampaign = {
  key: 'addContactToCampaign',
  noun: 'Contact',
  display: {
    label: 'Add Contact to Campaign',
    description:
      'Adds a contact (creating it if new) as a lead in a campaign. Idempotent by email.',
  },
  operation: {
    inputFields: [
      { key: 'email', label: 'Email', type: 'string', required: true },
      {
        key: 'campaign_id',
        label: 'Campaign',
        type: 'string',
        required: true,
        dynamic: 'campaignList.id.name',
      },
      { key: 'first_name', label: 'First name', type: 'string' },
      { key: 'last_name', label: 'Last name', type: 'string' },
      { key: 'company', label: 'Company', type: 'string' },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const contact = pruneEmpty({
        email: bundle.inputData.email,
        first_name: bundle.inputData.first_name,
        last_name: bundle.inputData.last_name,
        company: bundle.inputData.company,
        campaigns: [bundle.inputData.campaign_id],
      });
      const response = await z.request({
        url: api('/contacts'),
        method: 'POST',
        body: [contact],
      });
      return Array.isArray(response.data) ? response.data[0] : response.data;
    },
    sample: CONTACT_SAMPLE,
  },
};

const removeContactFromCampaign = {
  key: 'removeContactFromCampaign',
  noun: 'Contact',
  display: {
    label: 'Remove Contact from Campaign',
    description: 'Unenrolls a contact from a campaign without deleting the contact.',
  },
  operation: {
    inputFields: [
      contactIdField,
      {
        key: 'campaign_id',
        label: 'Campaign',
        type: 'string',
        required: true,
        dynamic: 'campaignList.id.name',
      },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      // Bulk PATCH supports remove_campaigns (single PATCH only replaces the
      // whole set), so this uses the bulk endpoint for one contact.
      const response = await z.request({
        url: api('/contacts'),
        method: 'PATCH',
        body: {
          contacts: [bundle.inputData.contact_id],
          remove_campaigns: [bundle.inputData.campaign_id],
        },
      });
      return Array.isArray(response.data) ? response.data[0] : response.data;
    },
    sample: CONTACT_SAMPLE,
  },
};

const NOTE_SAMPLE = {
  id: 'no1a2b3c-0000-0000-0000-000000000000',
  contact_id: CONTACT_SAMPLE.id,
  content: 'Met at the conference.',
  created_at: '2026-06-28T12:00:00Z',
};

const createContactNote = {
  key: 'createContactNote',
  noun: 'Note',
  display: { label: 'Create Contact Note', description: 'Adds a note to a contact.' },
  operation: {
    inputFields: [
      contactIdField,
      { key: 'content', label: 'Note', type: 'text', required: true },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const response = await z.request({
        url: api(`/contacts/${bundle.inputData.contact_id}/notes`),
        method: 'POST',
        body: { content: bundle.inputData.content },
      });
      return response.data;
    },
    sample: NOTE_SAMPLE,
  },
};

const updateContactNote = {
  key: 'updateContactNote',
  noun: 'Note',
  display: {
    label: 'Update Contact Note',
    description: 'Updates the text of an existing contact note.',
  },
  operation: {
    inputFields: [
      contactIdField,
      { key: 'note_id', label: 'Note ID', type: 'string', required: true },
      { key: 'content', label: 'Note', type: 'text', required: true },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const response = await z.request({
        url: api(
          `/contacts/${bundle.inputData.contact_id}/notes/${bundle.inputData.note_id}`,
        ),
        method: 'PATCH',
        body: { content: bundle.inputData.content },
      });
      return response.data;
    },
    sample: { ...NOTE_SAMPLE, content: 'Updated note text.' },
  },
};

const deleteContactNote = {
  key: 'deleteContactNote',
  noun: 'Note',
  display: {
    label: 'Delete Contact Note',
    description: 'Permanently deletes a contact note by ID.',
  },
  operation: {
    inputFields: [
      contactIdField,
      { key: 'note_id', label: 'Note ID', type: 'string', required: true },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      await z.request({
        url: api(
          `/contacts/${bundle.inputData.contact_id}/notes/${bundle.inputData.note_id}`,
        ),
        method: 'DELETE',
      });
      return { id: bundle.inputData.note_id, success: true };
    },
    sample: { id: NOTE_SAMPLE.id, success: true },
  },
};

const findContact = {
  key: 'findContact',
  noun: 'Contact',
  display: { label: 'Find Contact', description: 'Finds a contact by exact email address.' },
  operation: {
    inputFields: [{ key: 'email', label: 'Email', type: 'string', required: true }],
    perform: async (z: ZObject, bundle: Bundle): Promise<any[]> => {
      const response = await z.request({
        url: api('/contacts/lookup'),
        params: { email: bundle.inputData.email },
      });
      const contact = response.data && response.data.contact;
      return contact ? [contact] : [];
    },
    sample: CONTACT_SAMPLE,
  },
};

export const triggers = [newContact, newOrUpdatedContact];
export const creates = [
  createContact,
  updateContact,
  deleteContact,
  addContactToCampaign,
  removeContactFromCampaign,
  createContactNote,
  updateContactNote,
  deleteContactNote,
];
export const searches = [findContact];
