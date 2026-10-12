-- Campaigns created by the wizard before connections were written at creation
-- hold their follow-ups as disconnected steps, so only the first email ever
-- sent. Link the steps of every campaign that has two or more email steps and
-- no connection anywhere, in position order, which is the sequence the wizard
-- showed ("Follow-up 1, after N days").
WITH candidates AS (
    SELECT campaign_id
    FROM sequences
    GROUP BY campaign_id
    HAVING COUNT(*) >= 2
       AND bool_and(kind = 'email')
       AND bool_and(NOT COALESCE(
               jsonb_typeof(conditions->'branches') = 'array'
               AND jsonb_array_length(conditions->'branches') > 0, false))
),
ordered AS (
    SELECT s.id,
           LEAD(s.id) OVER (PARTITION BY s.campaign_id ORDER BY s.position ASC, s.created_at ASC) AS next_id
    FROM sequences s
    JOIN candidates c ON c.campaign_id = s.campaign_id
)
UPDATE sequences s
SET conditions = jsonb_build_object('branches', jsonb_build_array(jsonb_build_object(
        'branch_id', gen_random_uuid()::text,
        'target_step_id', o.next_id::text,
        'conditions', '[]'::jsonb)))
FROM ordered o
WHERE o.id = s.id AND o.next_id IS NOT NULL;
