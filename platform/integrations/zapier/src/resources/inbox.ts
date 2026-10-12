import type { Bundle, ZObject } from '../lib/types';
import { api, pruneEmpty } from '../lib/client';
import { pollList } from '../lib/poll';

const newInboundEmail = {
  key: 'newInboundEmail',
  noun: 'Email',
  display: {
    label: 'New Email Received',
    description:
      'Triggers on a new incoming email in the unified inbox, including replies to your campaigns. Requires Unibox (active trial or paid plan).',
  },
  operation: {
    perform: pollList('/unibox'),
    sample: {
      id: 'em1f2a3b-0000-0000-0000-000000000000',
      email_id: '00000000-0000-0000-0000-000000000000',
      thread_id: 'thread_abc',
      from_addr: ['lead@example.com'],
      to_addr: ['jane@acme.com'],
      subject: 'Re: quick question',
      snippet: 'Yes, let us set up a call...',
      internal_date: '2026-06-28T12:00:00Z',
      seen: false,
      message_count: 2,
      has_unread: true,
      labels: [],
    },
    outputFields: [
      { key: 'id', label: 'Message ID' },
      { key: 'email_id', label: 'Mailbox ID' },
      { key: 'thread_id', label: 'Thread ID' },
      { key: 'subject', label: 'Subject' },
      { key: 'snippet', label: 'Snippet' },
      { key: 'internal_date', label: 'Received at' },
      { key: 'seen', type: 'boolean', label: 'Seen' },
    ],
  },
};

const replyToEmail = {
  key: 'replyToEmail',
  noun: 'Email',
  display: {
    label: 'Reply in Inbox',
    description:
      'Sends a reply from a mailbox, optionally threading it into an existing conversation.',
  },
  operation: {
    inputFields: [
      {
        key: 'email_account_id',
        label: 'From mailbox',
        type: 'string',
        required: true,
        dynamic: 'mailboxList.id.email',
      },
      { key: 'to', label: 'To', type: 'string', list: true, required: true },
      { key: 'subject', label: 'Subject', type: 'string', required: true },
      { key: 'body_html', label: 'HTML body', type: 'text' },
      { key: 'body_plain', label: 'Plain-text body', type: 'text' },
      { key: 'cc', label: 'CC', type: 'string', list: true },
      { key: 'bcc', label: 'BCC', type: 'string', list: true },
      {
        key: 'thread_id',
        label: 'Thread ID',
        type: 'string',
        helpText: 'Thread to attach the reply to (from a New Email Received trigger).',
      },
      { key: 'in_reply_to', label: 'In reply to (message IDs)', type: 'string', list: true },
      {
        key: 'send_mode',
        label: 'Send mode',
        type: 'string',
        choices: { instant: 'Instant', smart: 'Smart', scheduled: 'Scheduled' },
        default: 'instant',
      },
      { key: 'scheduled_at', label: 'Scheduled at', type: 'datetime' },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const body = pruneEmpty({
        email_account_id: bundle.inputData.email_account_id,
        to: bundle.inputData.to,
        cc: bundle.inputData.cc,
        bcc: bundle.inputData.bcc,
        subject: bundle.inputData.subject,
        body_html: bundle.inputData.body_html,
        body_plain: bundle.inputData.body_plain,
        thread_id: bundle.inputData.thread_id,
        in_reply_to: bundle.inputData.in_reply_to,
        send_mode: bundle.inputData.send_mode,
        scheduled_at: bundle.inputData.scheduled_at,
      });
      const response = await z.request({ url: api('/unibox/reply'), method: 'POST', body });
      return response.data;
    },
    sample: {
      task_id: 'tk1a2b3c-0000-0000-0000-000000000000',
      scheduled_at: '2026-06-28T12:00:05Z',
      send_mode: 'instant',
    },
  },
};

const markEmailSeen = {
  key: 'markEmailSeen',
  noun: 'Email',
  display: {
    label: 'Mark Inbox Emails Seen',
    description: 'Marks one or more inbox messages as read or unread.',
  },
  operation: {
    inputFields: [
      { key: 'email_ids', label: 'Message IDs', type: 'string', list: true, required: true },
      {
        key: 'seen',
        label: 'Mark as',
        type: 'boolean',
        default: 'true',
        helpText: 'On = read, off = unread.',
      },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const response = await z.request({
        url: api('/unibox/seen'),
        method: 'PATCH',
        body: {
          email_ids: bundle.inputData.email_ids,
          seen: bundle.inputData.seen !== false,
        },
      });
      return response.data;
    },
    sample: { email_ids: ['em1f2a3b-0000-0000-0000-000000000000'], seen: true },
  },
};

export const triggers = [newInboundEmail];
export const creates = [replyToEmail, markEmailSeen];
export const searches: Array<{ key: string }> = [];
