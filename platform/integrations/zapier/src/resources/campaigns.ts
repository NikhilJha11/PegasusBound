import type { Bundle, ZObject } from '../lib/types';
import { api, listData, pruneEmpty } from '../lib/client';
import { pollList } from '../lib/poll';

const CAMPAIGN_SAMPLE = {
  id: 'ca1b2c3d-0000-0000-0000-000000000000',
  name: 'Q3 Outbound',
  description: '',
  status: 'active',
  daily_limit: 50,
  timezone: 'America/New_York',
  created_at: '2026-06-28T12:00:00Z',
  updated_at: '2026-06-28T12:00:00Z',
};

const CAMPAIGN_OUTPUT = [
  { key: 'id', label: 'Campaign ID' },
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'daily_limit', type: 'integer', label: 'Daily limit' },
  { key: 'created_at', label: 'Created at' },
];

const campaignField = {
  key: 'campaign_id',
  label: 'Campaign',
  type: 'string',
  required: true,
  dynamic: 'campaignList.id.name',
};

const newCampaign = {
  key: 'newCampaign',
  noun: 'Campaign',
  display: { label: 'New Campaign', description: 'Triggers when a campaign is created.' },
  operation: { perform: pollList('/campaigns'), sample: CAMPAIGN_SAMPLE, outputFields: CAMPAIGN_OUTPUT },
};

const campaignCompleted = {
  key: 'campaignCompleted',
  noun: 'Campaign',
  display: {
    label: 'Campaign Completed',
    description: 'Triggers when a campaign reaches the completed state.',
  },
  operation: {
    perform: pollList('/campaigns', { filter: (c: any) => c.status === 'completed' }),
    sample: { ...CAMPAIGN_SAMPLE, status: 'completed' },
    outputFields: CAMPAIGN_OUTPUT,
  },
};

const createCampaign = {
  key: 'createCampaign',
  noun: 'Campaign',
  display: {
    label: 'Create Campaign',
    description:
      'Creates a draft campaign. Add sequence steps, senders, and leads in Pegasusbound, then start it.',
  },
  operation: {
    inputFields: [
      { key: 'name', label: 'Name', type: 'string', required: true },
      { key: 'description', label: 'Description', type: 'text' },
      {
        key: 'daily_limit',
        label: 'Daily send cap',
        type: 'integer',
        helpText: 'Per-mailbox cold-send cap. Defaults to 50.',
      },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const body = pruneEmpty({
        name: bundle.inputData.name,
        description: bundle.inputData.description,
        daily_limit: bundle.inputData.daily_limit,
      });
      const response = await z.request({ url: api('/campaigns'), method: 'POST', body });
      return response.data;
    },
    sample: { ...CAMPAIGN_SAMPLE, status: 'draft' },
  },
};

const updateCampaign = {
  key: 'updateCampaign',
  noun: 'Campaign',
  display: {
    label: 'Update Campaign',
    description:
      'Updates campaign settings such as name, description, or daily send cap. Use Start/Stop Campaign to change its running state.',
  },
  operation: {
    inputFields: [
      campaignField,
      { key: 'name', label: 'Name', type: 'string' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'daily_limit', label: 'Daily send cap', type: 'integer' },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const body = pruneEmpty({
        name: bundle.inputData.name,
        description: bundle.inputData.description,
        daily_limit: bundle.inputData.daily_limit,
      });
      const response = await z.request({
        url: api(`/campaigns/${bundle.inputData.campaign_id}`),
        method: 'PATCH',
        body,
      });
      return response.data;
    },
    sample: CAMPAIGN_SAMPLE,
  },
};

const deleteCampaign = {
  key: 'deleteCampaign',
  noun: 'Campaign',
  display: {
    label: 'Delete Campaign',
    description: 'Permanently deletes a campaign by ID. This is irreversible.',
  },
  operation: {
    inputFields: [campaignField],
    perform: async (z: ZObject, bundle: Bundle) => {
      await z.request({ url: api(`/campaigns/${bundle.inputData.campaign_id}`), method: 'DELETE' });
      return { id: bundle.inputData.campaign_id, success: true };
    },
    sample: { id: CAMPAIGN_SAMPLE.id, success: true },
  },
};

const lifecycle = (action: 'start' | 'stop') =>
  async (z: ZObject, bundle: Bundle) => {
    const response = await z.request({
      url: api(`/campaigns/${bundle.inputData.campaign_id}/${action}`),
      method: 'POST',
    });
    return { campaign_id: bundle.inputData.campaign_id, ...response.data };
  };

const startCampaign = {
  key: 'startCampaign',
  noun: 'Campaign',
  display: { label: 'Start Campaign', description: 'Starts (or resumes) a campaign so it begins sending.' },
  operation: {
    inputFields: [campaignField],
    perform: lifecycle('start'),
    sample: { campaign_id: CAMPAIGN_SAMPLE.id, status: 'started' },
  },
};

const stopCampaign = {
  key: 'stopCampaign',
  noun: 'Campaign',
  display: { label: 'Stop Campaign', description: 'Pauses an active campaign.' },
  operation: {
    inputFields: [campaignField],
    perform: lifecycle('stop'),
    sample: { campaign_id: CAMPAIGN_SAMPLE.id, status: 'stopped' },
  },
};

const findCampaign = {
  key: 'findCampaign',
  noun: 'Campaign',
  display: { label: 'Find Campaign', description: 'Finds a campaign by name.' },
  operation: {
    inputFields: [{ key: 'query', label: 'Name contains', type: 'string', required: true }],
    perform: async (z: ZObject, bundle: Bundle): Promise<any[]> => {
      const response = await z.request({
        url: api('/campaigns'),
        params: { q: bundle.inputData.query, limit: 25 },
      });
      return listData(response);
    },
    sample: CAMPAIGN_SAMPLE,
  },
};

export const triggers = [newCampaign, campaignCompleted];
export const creates = [createCampaign, updateCampaign, deleteCampaign, startCampaign, stopCampaign];
export const searches = [findCampaign];
