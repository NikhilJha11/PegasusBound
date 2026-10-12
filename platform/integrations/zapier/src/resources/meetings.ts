import type { Bundle, ZObject } from '../lib/types';
import { api, listData, pruneEmpty } from '../lib/client';
import { pollList } from '../lib/poll';

const MEETING_SAMPLE = {
  id: 'mb1c2d3e-0000-0000-0000-000000000000',
  organization_id: '00000000-0000-0000-0000-000000000000',
  source: 'calendly',
  status: 'booked',
  invitee_email: 'lead@example.com',
  invitee_name: 'Sam Rivera',
  event_name: 'Intro call',
  scheduled_for: '2026-07-01T15:00:00Z',
  join_url: 'https://meet.example.com/abc',
  contact_id: '7b6c1f2a-0000-0000-0000-000000000000',
  created_at: '2026-06-28T12:00:00Z',
};

const MEETING_OUTPUT = [
  { key: 'id', label: 'Booking ID' },
  { key: 'source', label: 'Source' },
  { key: 'status', label: 'Status' },
  { key: 'invitee_email', label: 'Invitee email' },
  { key: 'invitee_name', label: 'Invitee name' },
  { key: 'event_name', label: 'Event name' },
  { key: 'scheduled_for', label: 'Scheduled for' },
  { key: 'join_url', label: 'Join URL' },
  { key: 'contact_id', label: 'Contact ID' },
];

const newMeeting = {
  key: 'newMeeting',
  noun: 'Meeting',
  display: {
    label: 'New Meeting Booked',
    description:
      'Triggers when a meeting is booked through a connected scheduler (Calendly, Cal.com) or logged manually.',
  },
  operation: { perform: pollList('/meetings'), sample: MEETING_SAMPLE, outputFields: MEETING_OUTPUT },
};

const createMeeting = {
  key: 'createMeeting',
  noun: 'Meeting',
  display: {
    label: 'Log Meeting',
    description: 'Records a meeting (source "manual") and attributes it to a contact by email or id.',
  },
  operation: {
    inputFields: [
      { key: 'title', label: 'Title', type: 'string', helpText: 'Defaults to "Call".' },
      { key: 'invitee_name', label: 'Invitee name', type: 'string' },
      { key: 'invitee_email', label: 'Invitee email', type: 'string' },
      {
        key: 'scheduled_for',
        label: 'Scheduled for',
        type: 'datetime',
        required: true,
      },
      { key: 'duration_minutes', label: 'Duration (minutes)', type: 'integer' },
      { key: 'location', label: 'Location', type: 'string' },
      { key: 'join_url', label: 'Join URL', type: 'string' },
      { key: 'contact_id', label: 'Contact', type: 'string', dynamic: 'contactList.id.name' },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const body = pruneEmpty({
        title: bundle.inputData.title,
        invitee_name: bundle.inputData.invitee_name,
        invitee_email: bundle.inputData.invitee_email,
        scheduled_for: bundle.inputData.scheduled_for,
        duration_minutes: bundle.inputData.duration_minutes,
        location: bundle.inputData.location,
        join_url: bundle.inputData.join_url,
        contact_id: bundle.inputData.contact_id,
      });
      const response = await z.request({ url: api('/meetings'), method: 'POST', body });
      // Handler returns { meeting: <booking> }.
      return (response.data && response.data.meeting) || response.data;
    },
    sample: { ...MEETING_SAMPLE, source: 'manual' },
  },
};

const deleteMeeting = {
  key: 'deleteMeeting',
  noun: 'Meeting',
  display: { label: 'Delete Meeting', description: 'Deletes a meeting booking by ID.' },
  operation: {
    inputFields: [{ key: 'meeting_id', label: 'Meeting ID', type: 'string', required: true }],
    perform: async (z: ZObject, bundle: Bundle) => {
      await z.request({ url: api(`/meetings/${bundle.inputData.meeting_id}`), method: 'DELETE' });
      return { id: bundle.inputData.meeting_id, success: true };
    },
    sample: { id: MEETING_SAMPLE.id, success: true },
  },
};

const findMeeting = {
  key: 'findMeeting',
  noun: 'Meeting',
  display: {
    label: 'Find Meeting',
    description: 'Finds a meeting by invitee name, invitee email, or event name.',
  },
  operation: {
    inputFields: [{ key: 'query', label: 'Search', type: 'string', required: true }],
    perform: async (z: ZObject, bundle: Bundle): Promise<any[]> => {
      const response = await z.request({
        url: api('/meetings'),
        params: { q: bundle.inputData.query, limit: 25 },
      });
      return listData(response);
    },
    sample: MEETING_SAMPLE,
  },
};

export const triggers = [newMeeting];
export const creates = [createMeeting, deleteMeeting];
export const searches = [findMeeting];
