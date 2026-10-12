import type { Bundle, ZObject } from '../lib/types';
import { api, listData, pruneEmpty } from '../lib/client';

const TEMPLATE_SAMPLE = {
  id: 'tp1a2b3c-0000-0000-0000-000000000000',
  name: 'Follow up',
  subject: 'Following up',
  body_plain: 'Just checking in...',
  position: 1,
  created_at: '2026-06-28T12:00:00Z',
};

const templateField = {
  key: 'template_id',
  label: 'Template',
  type: 'string',
  required: true,
  dynamic: 'templateList.id.name',
};

const createTemplate = {
  key: 'createTemplate',
  noun: 'Template',
  display: { label: 'Create Reply Template', description: 'Creates a reusable reply template for the unified inbox.' },
  operation: {
    inputFields: [
      { key: 'name', label: 'Name', type: 'string', required: true },
      { key: 'subject', label: 'Subject', type: 'string' },
      { key: 'body_html', label: 'HTML body', type: 'text' },
      { key: 'body_plain', label: 'Plain-text body', type: 'text' },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const body = pruneEmpty({
        name: bundle.inputData.name,
        subject: bundle.inputData.subject,
        body_html: bundle.inputData.body_html,
        body_plain: bundle.inputData.body_plain,
      });
      const response = await z.request({ url: api('/templates'), method: 'POST', body });
      return response.data;
    },
    sample: TEMPLATE_SAMPLE,
  },
};

const updateTemplate = {
  key: 'updateTemplate',
  noun: 'Template',
  display: { label: 'Update Reply Template', description: 'Updates an existing reply template.' },
  operation: {
    inputFields: [
      templateField,
      { key: 'name', label: 'Name', type: 'string' },
      { key: 'subject', label: 'Subject', type: 'string' },
      { key: 'body_html', label: 'HTML body', type: 'text' },
      { key: 'body_plain', label: 'Plain-text body', type: 'text' },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const body = pruneEmpty({
        name: bundle.inputData.name,
        subject: bundle.inputData.subject,
        body_html: bundle.inputData.body_html,
        body_plain: bundle.inputData.body_plain,
      });
      const response = await z.request({
        url: api(`/templates/${bundle.inputData.template_id}`),
        method: 'PATCH',
        body,
      });
      return response.data;
    },
    sample: { ...TEMPLATE_SAMPLE, name: 'Follow up v2' },
  },
};

const deleteTemplate = {
  key: 'deleteTemplate',
  noun: 'Template',
  display: { label: 'Delete Reply Template', description: 'Permanently deletes a reply template by ID.' },
  operation: {
    inputFields: [templateField],
    perform: async (z: ZObject, bundle: Bundle) => {
      await z.request({ url: api(`/templates/${bundle.inputData.template_id}`), method: 'DELETE' });
      return { id: bundle.inputData.template_id, success: true };
    },
    sample: { id: TEMPLATE_SAMPLE.id, success: true },
  },
};

const renderTemplate = {
  key: 'renderTemplate',
  noun: 'Template',
  display: {
    label: 'Render Reply Template',
    description: 'Fills a template with variables and returns the rendered subject and body.',
  },
  operation: {
    inputFields: [
      templateField,
      {
        key: 'variables',
        label: 'Variables',
        dict: true,
        helpText: 'Placeholder values, for example first_name = Sam.',
      },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const response = await z.request({
        url: api(`/templates/${bundle.inputData.template_id}/render`),
        method: 'POST',
        body: { variables: bundle.inputData.variables || {} },
      });
      return response.data;
    },
    sample: { subject: 'Following up, Sam', body_html: '<p>Hi Sam</p>', body_plain: 'Hi Sam' },
  },
};

const findTemplate = {
  key: 'findTemplate',
  noun: 'Template',
  display: { label: 'Find Reply Template', description: 'Finds a reply template by name or subject.' },
  operation: {
    inputFields: [
      { key: 'query', label: 'Name or subject contains', type: 'string', required: true },
    ],
    perform: async (z: ZObject, bundle: Bundle): Promise<any[]> => {
      const response = await z.request({ url: api('/templates'), params: { q: bundle.inputData.query } });
      return listData(response);
    },
    sample: TEMPLATE_SAMPLE,
  },
};

export const triggers: Array<{ key: string }> = [];
export const creates = [createTemplate, updateTemplate, deleteTemplate, renderTemplate];
export const searches = [findTemplate];
