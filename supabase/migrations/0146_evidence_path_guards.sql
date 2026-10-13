-- 0146_evidence_path_guards.sql
--
-- ESC-36: evidence and attachments may only point at the author's own uploads.
--
-- `verifyEvidencePaths` and the message attachment check enforce the caller prefix in
-- TypeScript, but a direct insert under RLS skipped both, so a member could attach a
-- path inside another member's folder and have staff (or the counterparty) open it.
-- These triggers are the same rule at the row. The evidence limit (10) is pinned to
-- the TypeScript constant by tests/unit/migrationEvidenceGuards.test.ts.

create or replace function cardtrade.dispute_evidence_path_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_path text;
begin
  if coalesce(array_length(new.media_paths, 1), 0) > 10 then
    raise exception 'invalid-path' using errcode = 'P0001';
  end if;
  foreach v_path in array coalesce(new.media_paths, array[]::text[]) loop
    if v_path is null or left(v_path, length(new.author_id::text) + 1) <> new.author_id::text || '/'
       or position('..' in v_path) > 0 then
      raise exception 'invalid-path' using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$function$;

drop trigger if exists dispute_evidence_path_guard on cardtrade.dispute_evidence;
create trigger dispute_evidence_path_guard
  before insert on cardtrade.dispute_evidence
  for each row execute function cardtrade.dispute_evidence_path_guard();

create or replace function cardtrade.message_attachment_path_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.attachment_path is not null
     and (left(new.attachment_path, length(new.sender_id::text) + 1) <> new.sender_id::text || '/'
          or position('..' in new.attachment_path) > 0) then
    raise exception 'invalid-path' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists message_attachment_path_guard on cardtrade.messages;
create trigger message_attachment_path_guard
  before insert on cardtrade.messages
  for each row execute function cardtrade.message_attachment_path_guard();

-- Grants last.
revoke all on function cardtrade.dispute_evidence_path_guard() from public, anon, authenticated;
revoke all on function cardtrade.message_attachment_path_guard() from public, anon, authenticated;
