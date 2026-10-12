import type { Bundle, ZObject } from '../lib/types';
import { api, listData, pruneEmpty } from '../lib/client';
import { pollList } from '../lib/poll';

const TASK_SAMPLE = {
  id: 'ta5b6c7d-0000-0000-0000-000000000000',
  organization_id: '00000000-0000-0000-0000-000000000000',
  title: 'Call Example Co',
  description: 'Discuss pilot',
  status: 'pending',
  priority: 'medium',
  type: 'Call',
  contact_id: '7b6c1f2a-0000-0000-0000-000000000000',
  due_date: '2026-06-30T09:00:00Z',
  created_at: '2026-06-28T12:00:00Z',
};

const TASK_OUTPUT = [
  { key: 'id', label: 'Task ID' },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'type', label: 'Type' },
  { key: 'contact_id', label: 'Contact ID' },
  { key: 'deal_id', label: 'Deal ID' },
  { key: 'due_date', label: 'Due date' },
  { key: 'created_at', label: 'Created at' },
];

const PRIORITY_CHOICES = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
const STATUS_CHOICES = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const newCrmTask = {
  key: 'newCrmTask',
  noun: 'Task',
  display: { label: 'New CRM Task', description: 'Triggers when a CRM task is created.' },
  operation: { perform: pollList('/crm/tasks'), sample: TASK_SAMPLE, outputFields: TASK_OUTPUT },
};

const createCrmTask = {
  key: 'createCrmTask',
  noun: 'Task',
  display: {
    label: 'Create CRM Task',
    description: 'Creates a CRM task, optionally linked to a contact or deal.',
  },
  operation: {
    inputFields: [
      { key: 'title', label: 'Title', type: 'string', required: true },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'contact_id', label: 'Contact', type: 'string', dynamic: 'contactList.id.name' },
      { key: 'deal_id', label: 'Deal ID', type: 'string' },
      { key: 'assigned_to', label: 'Assignee (user ID)', type: 'string' },
      { key: 'due_date', label: 'Due date', type: 'datetime' },
      { key: 'priority', label: 'Priority', type: 'string', choices: PRIORITY_CHOICES },
      { key: 'type', label: 'Type', type: 'string', helpText: 'e.g. Call, Email, Meeting.' },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const body = pruneEmpty({
        title: bundle.inputData.title,
        description: bundle.inputData.description,
        contact_id: bundle.inputData.contact_id,
        deal_id: bundle.inputData.deal_id,
        assigned_to: bundle.inputData.assigned_to,
        due_date: bundle.inputData.due_date,
        priority: bundle.inputData.priority,
        type: bundle.inputData.type,
      });
      const response = await z.request({ url: api('/crm/tasks'), method: 'POST', body });
      return response.data;
    },
    sample: TASK_SAMPLE,
  },
};

const updateCrmTask = {
  key: 'updateCrmTask',
  noun: 'Task',
  display: {
    label: 'Update CRM Task',
    description: 'Updates a CRM task, for example to mark it complete or change status, priority, or due date.',
  },
  operation: {
    inputFields: [
      { key: 'task_id', label: 'Task ID', type: 'string', required: true },
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'status', label: 'Status', type: 'string', choices: STATUS_CHOICES },
      { key: 'priority', label: 'Priority', type: 'string', choices: PRIORITY_CHOICES },
      { key: 'due_date', label: 'Due date', type: 'datetime' },
      { key: 'type', label: 'Type', type: 'string' },
      { key: 'contact_id', label: 'Contact', type: 'string', dynamic: 'contactList.id.name' },
      { key: 'deal_id', label: 'Deal ID', type: 'string' },
      { key: 'assigned_to', label: 'Assignee (user ID)', type: 'string' },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const body = pruneEmpty({
        title: bundle.inputData.title,
        description: bundle.inputData.description,
        status: bundle.inputData.status,
        priority: bundle.inputData.priority,
        due_date: bundle.inputData.due_date,
        type: bundle.inputData.type,
        contact_id: bundle.inputData.contact_id,
        deal_id: bundle.inputData.deal_id,
        assigned_to: bundle.inputData.assigned_to,
      });
      const response = await z.request({
        url: api(`/crm/tasks/${bundle.inputData.task_id}`),
        method: 'PATCH',
        body,
      });
      return response.data;
    },
    sample: { ...TASK_SAMPLE, status: 'completed' },
  },
};

const deleteCrmTask = {
  key: 'deleteCrmTask',
  noun: 'Task',
  display: { label: 'Delete CRM Task', description: 'Permanently deletes a CRM task by ID.' },
  operation: {
    inputFields: [{ key: 'task_id', label: 'Task ID', type: 'string', required: true }],
    perform: async (z: ZObject, bundle: Bundle) => {
      await z.request({ url: api(`/crm/tasks/${bundle.inputData.task_id}`), method: 'DELETE' });
      return { id: bundle.inputData.task_id, success: true };
    },
    sample: { id: TASK_SAMPLE.id, success: true },
  },
};

const findCrmTask = {
  key: 'findCrmTask',
  noun: 'Task',
  display: { label: 'Find CRM Task', description: 'Finds a CRM task by title (and optional status).' },
  operation: {
    inputFields: [
      { key: 'query', label: 'Title contains', type: 'string', required: true },
      { key: 'status', label: 'Status', type: 'string', choices: STATUS_CHOICES },
    ],
    perform: async (z: ZObject, bundle: Bundle): Promise<any[]> => {
      const body = pruneEmpty({
        query: bundle.inputData.query,
        statuses: bundle.inputData.status ? [bundle.inputData.status] : undefined,
      });
      const response = await z.request({
        url: api('/crm/tasks/search'),
        method: 'POST',
        params: { limit: 25 },
        body,
      });
      return listData(response);
    },
    sample: TASK_SAMPLE,
  },
};

export const triggers = [newCrmTask];
export const creates = [createCrmTask, updateCrmTask, deleteCrmTask];
export const searches = [findCrmTask];
