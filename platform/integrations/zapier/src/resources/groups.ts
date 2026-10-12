import type { Bundle, ZObject } from '../lib/types';
import { api, pruneEmpty } from '../lib/client';

const GROUP_SAMPLE = {
  id: 'gr1a2b3c-0000-0000-0000-000000000000',
  title: 'VIP',
  color: '#0ea5e9',
  position: 1,
  created_at: '2026-06-28T12:00:00Z',
  updated_at: '2026-06-28T12:00:00Z',
};

// Tags, categories, and folders share the generic group endpoint shape
// (POST /<resource> with { title, color }). There is no API list endpoint for
// them, so the create action returns the new id for downstream steps.
const groupCreate = (
  key: string,
  path: string,
  label: string,
  description: string,
) => ({
  key,
  noun: 'Group',
  display: { label, description },
  operation: {
    inputFields: [
      { key: 'title', label: 'Title', type: 'string', required: true },
      { key: 'color', label: 'Color', type: 'string', helpText: 'Optional hex color, e.g. #0ea5e9.' },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const body = pruneEmpty({ title: bundle.inputData.title, color: bundle.inputData.color });
      const response = await z.request({ url: api(path), method: 'POST', body });
      return response.data;
    },
    sample: GROUP_SAMPLE,
  },
});

const createCategory = groupCreate(
  'createCategory',
  '/categories',
  'Create Contact Category',
  'Creates a contact category. Returns its id for use when creating contacts.',
);
const createTag = groupCreate(
  'createTag',
  '/tags',
  'Create Mailbox Tag',
  'Creates a tag used to group mailboxes.',
);
const createFolder = groupCreate(
  'createFolder',
  '/folders',
  'Create Campaign Folder',
  'Creates a folder used to group campaigns.',
);

export const triggers: Array<{ key: string }> = [];
export const creates = [createCategory, createTag, createFolder];
export const searches: Array<{ key: string }> = [];
