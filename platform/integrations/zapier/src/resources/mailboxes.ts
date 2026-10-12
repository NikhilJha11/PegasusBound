import type { Bundle, ZObject } from '../lib/types';
import { api, pruneEmpty } from '../lib/client';
import { pollList } from '../lib/poll';

const MAILBOX_SAMPLE = {
  id: 'eb1a2c3d-0000-0000-0000-000000000000',
  email: 'jane@acme.com',
  name: 'Jane Doe',
  provider: 'gmail',
  status: 'active',
  campaign_limit: 50,
  warmup_pool_type: 'premium',
  created_at: '2026-06-28T12:00:00Z',
};

const SEND_RESULT_SAMPLE = {
  task_id: 'tk1a2b3c-0000-0000-0000-000000000000',
  scheduled_at: '2026-06-28T12:00:05Z',
  send_mode: 'instant',
};

const mailboxField = {
  key: 'email_account_id',
  label: 'Mailbox',
  type: 'string',
  required: true,
  dynamic: 'mailboxList.id.email',
};

const newMailbox = {
  key: 'newMailbox',
  noun: 'Mailbox',
  display: {
    label: 'New Mailbox Connected',
    description: 'Triggers when an email account (mailbox) is connected.',
  },
  operation: {
    perform: pollList('/emails'),
    sample: MAILBOX_SAMPLE,
    outputFields: [
      { key: 'id', label: 'Mailbox ID' },
      { key: 'email', label: 'Email' },
      { key: 'name', label: 'Name' },
      { key: 'provider', label: 'Provider' },
      { key: 'status', label: 'Status' },
      { key: 'campaign_limit', type: 'integer', label: 'Daily campaign cap' },
      { key: 'created_at', label: 'Created at' },
    ],
  },
};

const sendEmail = {
  key: 'sendEmail',
  noun: 'Email',
  display: { label: 'Send Email', description: 'Sends a one-off email from one of your connected mailboxes.' },
  operation: {
    inputFields: [
      mailboxField,
      { key: 'to', label: 'To', type: 'string', list: true, required: true },
      { key: 'subject', label: 'Subject', type: 'string', required: true },
      { key: 'body_html', label: 'HTML body', type: 'text' },
      { key: 'body_plain', label: 'Plain-text body', type: 'text' },
      { key: 'cc', label: 'CC', type: 'string', list: true },
      { key: 'bcc', label: 'BCC', type: 'string', list: true },
      {
        key: 'send_mode',
        label: 'Send mode',
        type: 'string',
        choices: {
          instant: 'Instant',
          smart: 'Smart (respect the mailbox send gap)',
          scheduled: 'Scheduled (use the scheduled time)',
        },
        default: 'instant',
      },
      {
        key: 'scheduled_at',
        label: 'Scheduled at',
        type: 'datetime',
        helpText: 'Only used when send mode is Scheduled. Must be in the future.',
      },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const body = pruneEmpty({
        to: bundle.inputData.to,
        cc: bundle.inputData.cc,
        bcc: bundle.inputData.bcc,
        subject: bundle.inputData.subject,
        body_html: bundle.inputData.body_html,
        body_plain: bundle.inputData.body_plain,
        send_mode: bundle.inputData.send_mode,
        scheduled_at: bundle.inputData.scheduled_at,
      });
      const response = await z.request({
        url: api(`/emails/${bundle.inputData.email_account_id}/send`),
        method: 'POST',
        body,
      });
      return response.data;
    },
    sample: SEND_RESULT_SAMPLE,
  },
};

const verifyEmail = {
  key: 'verifyEmail',
  noun: 'Verification',
  display: {
    label: 'Verify Email Address',
    description:
      'Runs a deliverability check (syntax, MX, SMTP probe, catch-all) on an address before you send.',
  },
  operation: {
    inputFields: [{ key: 'email', label: 'Email', type: 'string', required: true }],
    perform: async (z: ZObject, bundle: Bundle) => {
      const response = await z.request({
        url: api('/emails/verify'),
        method: 'POST',
        body: { email: bundle.inputData.email },
      });
      return response.data;
    },
    sample: {
      email: 'lead@example.com',
      status: 'valid',
      reason: 'deliverable',
      is_catch_all: false,
      has_mx: true,
      checked_at: '2026-06-28T12:00:00Z',
    },
  },
};

const updateMailbox = {
  key: 'updateMailbox',
  noun: 'Mailbox',
  display: {
    label: 'Update Mailbox',
    description: 'Updates mailbox settings such as display name, daily cap, send gap, or reply-to.',
  },
  operation: {
    inputFields: [
      mailboxField,
      { key: 'name', label: 'Display name', type: 'string' },
      { key: 'campaign_limit', label: 'Daily campaign cap', type: 'integer', helpText: '0 to 5000. Default 50; 30 to 50 per day is the safe cold-outreach band.' },
      { key: 'min_wait_time', label: 'Minimum gap between sends (seconds)', type: 'integer' },
      { key: 'reply_to', label: 'Reply-to address', type: 'string' },
    ],
    perform: async (z: ZObject, bundle: Bundle) => {
      const body = pruneEmpty({
        name: bundle.inputData.name,
        campaign_limit: bundle.inputData.campaign_limit,
        min_wait_time: bundle.inputData.min_wait_time,
        reply_to: bundle.inputData.reply_to,
      });
      const response = await z.request({
        url: api(`/emails/${bundle.inputData.email_account_id}`),
        method: 'PATCH',
        body,
      });
      return response.data;
    },
    sample: MAILBOX_SAMPLE,
  },
};

const deleteMailbox = {
  key: 'deleteMailbox',
  noun: 'Mailbox',
  display: {
    label: 'Delete Mailbox',
    description:
      'Permanently disconnects and deletes an email account. This stops all warmup and campaign sending from it and is irreversible. Use with care.',
  },
  operation: {
    inputFields: [mailboxField],
    perform: async (z: ZObject, bundle: Bundle) => {
      await z.request({ url: api(`/emails/${bundle.inputData.email_account_id}`), method: 'DELETE' });
      return { id: bundle.inputData.email_account_id, success: true };
    },
    sample: { id: MAILBOX_SAMPLE.id, success: true },
  },
};

// Warmup lifecycle: bodyless POSTs that return the updated mailbox.
const warmupAction = (
  key: string,
  action: 'start' | 'pause' | 'resume' | 'stop',
  label: string,
  description: string,
) => ({
  key,
  noun: 'Mailbox',
  display: { label, description },
  operation: {
    inputFields: [mailboxField],
    perform: async (z: ZObject, bundle: Bundle) => {
      const response = await z.request({
        url: api(`/emails/${bundle.inputData.email_account_id}/warmup/${action}`),
        method: 'POST',
      });
      return response.data;
    },
    sample: MAILBOX_SAMPLE,
  },
});

const startWarmup = warmupAction(
  'startWarmup',
  'start',
  'Start Warmup',
  'Enables or resumes warmup on a mailbox, keeping ramp progress.',
);
const pauseWarmup = warmupAction(
  'pauseWarmup',
  'pause',
  'Pause Warmup',
  'Pauses warmup without losing ramp progress.',
);
const resumeWarmup = warmupAction(
  'resumeWarmup',
  'resume',
  'Resume Warmup',
  'Resumes a paused warmup, continuing the ramp.',
);
const stopWarmup = warmupAction(
  'stopWarmup',
  'stop',
  'Stop Warmup',
  'Disables warmup entirely and resets ramp progress.',
);

const findMailbox = {
  key: 'findMailbox',
  noun: 'Mailbox',
  display: { label: 'Find Mailbox', description: 'Finds a connected mailbox by email or name.' },
  operation: {
    inputFields: [
      { key: 'query', label: 'Email or name contains', type: 'string', required: true },
    ],
    perform: async (z: ZObject, bundle: Bundle): Promise<any[]> => {
      const response = await z.request({
        url: api('/emails'),
        params: { q: bundle.inputData.query, limit: 25 },
      });
      const payload = response.data;
      return Array.isArray(payload) ? payload : (payload && payload.data) || [];
    },
    sample: MAILBOX_SAMPLE,
  },
};

export const triggers = [newMailbox];
export const creates = [
  sendEmail,
  verifyEmail,
  updateMailbox,
  deleteMailbox,
  startWarmup,
  pauseWarmup,
  resumeWarmup,
  stopWarmup,
];
export const searches = [findMailbox];
