-- Issue #200: the pre-send verifier read ANY 5xx reply to RCPT TO as "this
-- recipient does not exist". Servers use that range to reject the PROBE too --
-- a non-FQDN HELO (the old default greeting was literally "localhost"), an
-- unacceptable envelope sender, relay policy, IP reputation -- and Postfix
-- reports those on RCPT because smtpd_delay_reject defers them there. Every
-- address checked through such a server was permanently marked 'invalid', and
-- because ListUnverifiedContacts only revisits 'unknown' contacts that were
-- never checked, nothing re-examined them. The campaign scheduler then skipped
-- those leads forever, which is what stalled sending entirely.
--
-- Reset exactly the verdicts the corrected classifier would no longer reach:
-- a recorded reason that names the PROBE and not the RECIPIENT. 'unknown' is
-- the safe landing state (the pre-send gate never drops it), and the
-- verification scheduler re-checks these contacts on its next pass.
UPDATE contacts
SET verification_status = 'unknown',
    verification_reason = '',
    verification_checked_at = NULL,
    updated_at = NOW()
WHERE verification_status = 'invalid'
  -- A reason naming the recipient stays invalid: the new classifier gives
  -- those phrases priority over everything below, whatever the reply code.
  AND verification_reason !~* '(user unknown|unknown user|no such user|no such recipient|no such mailbox|user not found|recipient not found|recipient unknown|unknown recipient|recipient address rejected|recipient rejected:|invalid recipient|invalid mailbox|mailbox unavailable|mailbox not found|mailbox does not exist|mailbox is disabled|mailbox disabled|account has been disabled|account is disabled|account does not exist|address does not exist|does not exist|doesn''t exist|unrouteable address|unroutable address|no mailbox here|not a valid mailbox)'
  AND (
    -- The greeting, session, sender or connecting host was refused.
    verification_reason ~* '(helo|ehlo|fully.qualified|relay|client host|sender address rejected|sender verify failed|sender rejected|authentication required|not authorized|blacklist|blocklist|blocked using|spamhaus|reputation|rate limit|greylist|service unavailable|policy)'
    -- Enhanced status classes that never describe the recipient:
    -- 5.3 system, 5.4 routing, 5.5 protocol, 5.6 content, 5.7 security.
    OR verification_reason ~ '\(5[0-9][0-9]\): *5\.[34567]\.'
    -- Basic codes that reject the COMMAND (500-504) or report a FULL mailbox
    -- (552); neither means the address is unknown.
    OR verification_reason ~ '\(50[0-4]\)'
    OR verification_reason ~ '\(552\)'
  );
