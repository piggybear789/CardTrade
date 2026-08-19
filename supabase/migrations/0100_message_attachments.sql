-- 0100_message_attachments.sql
--
-- Chat can carry one file per message. Photos of a meetup or a receipt belong in
-- the thread, not as a pasted URL. The bucket is private: a stored path is not a
-- URL. Reads go through a short-lived signed URL after a participation check.

alter table cardtrade.messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_bytes integer;

comment on column cardtrade.messages.attachment_path is
  'Object path in the message-attachments bucket. Null when the message is text only.';

comment on column cardtrade.messages.attachment_name is
  'Original filename, for the download label. Null iff attachment_path is null.';

comment on column cardtrade.messages.attachment_mime is
  'Declared MIME type of the attachment. Null iff attachment_path is null.';

comment on column cardtrade.messages.attachment_bytes is
  'Size in bytes. Null iff attachment_path is null.';

alter table cardtrade.messages
  drop constraint if exists messages_has_content;

alter table cardtrade.messages
  add constraint messages_has_content check (
    length(btrim(body)) > 0
    or attachment_path is not null
  );

alter table cardtrade.messages
  drop constraint if exists messages_attachment_shape;

alter table cardtrade.messages
  add constraint messages_attachment_shape check (
    (
      attachment_path is null
      and attachment_name is null
      and attachment_mime is null
      and attachment_bytes is null
    )
    or (
      attachment_path is not null
      and attachment_name is not null
      and attachment_mime is not null
      and attachment_bytes is not null
      and attachment_bytes > 0
    )
  );

alter table cardtrade.messages
  drop constraint if exists messages_system_no_attachment;

alter table cardtrade.messages
  add constraint messages_system_no_attachment check (
    kind = 'USER' or attachment_path is null
  );

-- 0077 named the insertable columns. New ones must be granted or sendMessage
-- cannot persist an attachment.
grant insert (
  attachment_path,
  attachment_name,
  attachment_mime,
  attachment_bytes
) on cardtrade.messages to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-attachments',
  'message-attachments',
  false,
  10485760, -- 10 MB
  array[
    'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic',
    'application/pdf'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
