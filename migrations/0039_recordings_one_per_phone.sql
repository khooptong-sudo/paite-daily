-- One live clip per phone per line. A rejected clip does not count, so the cap and the unique key agree.
-- Old code could, in a rare double tap, store two live clips from one phone for one line. Nothing is deleted:
-- before the index goes in, the extra live clips are marked rejected with a note (rows and audio stay). The clip
-- kept is the one already exported, else an accepted one, else the earliest.
UPDATE recordings
   SET status = 'rejected', reviewed_at = COALESCE(reviewed_at, datetime('now')),
       review_note = COALESCE(review_note || ' / ', '') || 'Duplicate from the same phone for this line; set aside when one clip per phone was enforced.'
 WHERE status != 'rejected'
   AND id IN (
     SELECT id FROM (
       SELECT id, row_number() OVER (PARTITION BY review_id, phone_id
                ORDER BY (exported_at IS NOT NULL) DESC, (status = 'accepted') DESC, id) AS rn
         FROM recordings WHERE status != 'rejected')
     WHERE rn > 1);
CREATE UNIQUE INDEX recordings_one_per_phone ON recordings (review_id, phone_id) WHERE status != 'rejected';
