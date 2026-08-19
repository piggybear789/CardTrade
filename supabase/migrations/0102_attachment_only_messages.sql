-- 0102_attachment_only_messages.sql
--
-- 0100 let a message be an attachment with no caption, and replaced
-- `messages_has_content` accordingly — but the original messaging migration
-- also left an inline column check (`messages_body_check`) demanding
-- char_length(body) >= 1. A photo sent without a caption therefore failed the
-- insert with a check violation even though the upload succeeded.
--
-- Content presence ("body or attachment") is `messages_has_content`'s job, so
-- the body check keeps only the length ceiling.

alter table cardtrade.messages
  drop constraint if exists messages_body_check;

alter table cardtrade.messages
  add constraint messages_body_check check (char_length(body) <= 4000);
