import type { Bundle, ZObject } from '../lib/types';
import { api, listData, pruneEmpty } from '../lib/client';
import { pollList } from '../lib/poll';

const DEAL_SAMPLE = {
  id: 'd1a2b3c4-0000-0000-0000-000000000000',
  organization_id: '00000000-0000-0000-0000-000000000000',
  pipeline_id: '00000000-0000-0000-0000-000000000001',
  stage_id: '00000000-0000-0000-0000-000000000002',
  contact_id: '7b6c1f2a-0000-0000-0000-000000000000',
  name: 'Example Co — annual',
  value: 12000,
  currency: 'USD',
  status: 'open',
  created_at: '2026-06-28T12:00:00Z',
  updated_at: '2026-06-28T12:00:00Z',
};

const DEAL_OUTPUT = [
  { key: 'id', label: 'Deal ID' },
  { key: 'name', label: 'Name' },
  { key: 'value', type: 'number', label: 'Value' },
  { key: 'currency', label: 'Currency' },
  { key: 'status', label: 'Status' },
  { key: 'pipeline_id', label: 'Pipeline ID' },
  { key: 'stage_id', label: 'Stage ID' },
  { key: 'contact_id', label: 'Contact ID' },
  { key: 'created_at', label: 'Created at' },
];

const newDeal = {
  key: 'newDeal',
  noun: 'Deal',
  display: { label: 'New Deal', description: 'Triggers when a CRM deal is created.' },
  operation: { perform: pollList('/crm/deals'), sample: DEAL_SAMPLE, outputFields: DEAL_OUTPUT },
};

const dealWon = {
  key: 'dealWon',
  noun: 'Deal',
  display: { label: 'Deal Won', description: 'Triggers when a CRM deal is in the won state.' },
  operation: {
    perform: pollList('/crm/deals', { query: () => ({ status: 'won' }) }),
    sample: { ...DEAL_SAMPLE, status: 'won', won_at: '2026-06-28T13:00:00Z' },
    outputFields: DEAL_OUTPUT,
  },
};

const createDeal = {
  key: 'createDeal',
  noun: 'Deal',
  display: { label: 'Create Deal', description: 'Creates a CRM deal in a pipeline stage.' },
  operation: {
    inputFields: [
      {
        key: 'pipeline_id',
        label: 'Pipeline',
        type: 'string',
        required: true,
        dynamic: 'pipelineList.id.name',
        altersDynamicFields: true,
      },
      {
        key: 'stage_id',
        label: 'Stage',
        type: 'string',
        required: true,
        dynamic: 'stageList.id.name',
      },
      { key: 'name', label: 'Name', type: 'string', required: true },
      { key: 'value', label: 'Value', type: 'number' },
      { key: 'currency', label: 'Currency', type: 'string', helpText: 'ISO code, e.g. USD.' },
      { key: 'contact_id', label: 'Contact', type: 'string', dynamic: 'contactList.id.name' },
      { key: 'expected_close_date', label: 'Expected close date', type: 'datetime' },
      { key: 'assigned_to', label: 'Owner (user ID)', type: 'string' },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const body = pruneEmpty({
        pipeline_id: bundle.inputData.pipeline_id,
        stage_id: bundle.inputData.stage_id,
        name: bundle.inputData.name,
        value: bundle.inputData.value,
        currency: bundle.inputData.currency,
        contact_id: bundle.inputData.contact_id,
        expected_close_date: bundle.inputData.expected_close_date,
        assigned_to: bundle.inputData.assigned_to,
      });
      const response = await z.request({ url: api('/crm/deals'), method: 'POST', body });
      return response.data;
    },
    sample: DEAL_SAMPLE,
  },
};

const updateDeal = {
  key: 'updateDeal',
  noun: 'Deal',
  display: {
    label: 'Update Deal',
    description: 'Updates a CRM deal: move stages, change value, or mark it won/lost.',
  },
  operation: {
    inputFields: [
      { key: 'deal_id', label: 'Deal ID', type: 'string', required: true },
      {
        key: 'pipeline_id',
        label: 'Pipeline (for stage picker)',
        type: 'string',
        dynamic: 'pipelineList.id.name',
        altersDynamicFields: true,
        helpText: 'Optional: pick the pipeline to populate the stage dropdown.',
      },
      { key: 'stage_id', label: 'Stage', type: 'string', dynamic: 'stageList.id.name' },
      { key: 'name', label: 'Name', type: 'string' },
      { key: 'value', label: 'Value', type: 'number' },
      { key: 'currency', label: 'Currency', type: 'string' },
      {
        key: 'status',
        label: 'Status',
        type: 'string',
        choices: { open: 'Open', won: 'Won', lost: 'Lost' },
      },
      { key: 'lost_reason', label: 'Lost reason', type: 'string' },
      { key: 'expected_close_date', label: 'Expected close date', type: 'datetime' },
      { key: 'assigned_to', label: 'Owner (user ID)', type: 'string' },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const body = pruneEmpty({
        stage_id: bundle.inputData.stage_id,
        name: bundle.inputData.name,
        value: bundle.inputData.value,
        currency: bundle.inputData.currency,
        status: bundle.inputData.status,
        lost_reason: bundle.inputData.lost_reason,
        expected_close_date: bundle.inputData.expected_close_date,
        assigned_to: bundle.inputData.assigned_to,
      });
      const response = await z.request({
        url: api(`/crm/deals/${bundle.inputData.deal_id}`),
        method: 'PATCH',
        body,
      });
      return response.data;
    },
    sample: DEAL_SAMPLE,
  },
};

const deleteDeal = {
  key: 'deleteDeal',
  noun: 'Deal',
  display: { label: 'Delete Deal', description: 'Permanently deletes a CRM deal by ID.' },
  operation: {
    inputFields: [{ key: 'deal_id', label: 'Deal ID', type: 'string', required: true }],
    perform: async (z: ZObject, bundle: Bundle) => {
      await z.request({ url: api(`/crm/deals/${bundle.inputData.deal_id}`), method: 'DELETE' });
      return { id: bundle.inputData.deal_id, success: true };
    },
    sample: { id: DEAL_SAMPLE.id, success: true },
  },
};

const findDeal = {
  key: 'findDeal',
  noun: 'Deal',
  display: { label: 'Find Deal', description: 'Finds a CRM deal by name (and optional status).' },
  operation: {
    inputFields: [
      { key: 'query', label: 'Name contains', type: 'string', required: true },
      {
        key: 'status',
        label: 'Status',
        type: 'string',
        choices: { open: 'Open', won: 'Won', lost: 'Lost' },
      },
    ],
    perform: async (z: ZObject, bundle: Bundle): Promise<any[]> => {
      const body = pruneEmpty({
        query: bundle.inputData.query,
        statuses: bundle.inputData.status ? [bundle.inputData.status] : undefined,
      });
      const response = await z.request({
        url: api('/crm/deals/search'),
        method: 'POST',
        params: { limit: 25 },
        body,
      });
      return listData(response);
    },
    sample: DEAL_SAMPLE,
  },
};

export const triggers = [newDeal, dealWon];
export const creates = [createDeal, updateDeal, deleteDeal];
export const searches = [findDeal];
