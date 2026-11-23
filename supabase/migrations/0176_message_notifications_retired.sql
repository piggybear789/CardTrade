-- 0176_message_notifications_retired.sql
--
-- A sent message no longer writes a MESSAGE notification (lib/actions/messages.ts).
-- The inbox badge already counts unread messages, so the bell row was the same
-- message counted twice.
--
-- Rows written before this change are marked read so they stop lighting the bell.
-- They are kept, not deleted: they are history, and the enum value stays so the
-- existing rows (and the Flutter enum) still parse.

update cardtrade.notifications
   set read_at = now()
 where type = 'MESSAGE'
   and read_at is null;
