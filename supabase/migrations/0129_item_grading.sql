-- 0129_item_grading.sql
--
-- Slab details for graded listings: grader, grade and cert number.
--
-- A graded card was a listing whose condition read "Graded" and nothing else — the
-- grader, the grade and the cert lived in the title or the photo, so a buyer could not
-- see them as facts, filter on them, or check the slab against the grader's registry.
--
-- Nullable, because every existing graded listing predates them and older clients
-- (the Flutter app, the mobile API) do not send them. The application requires grader
-- and grade when the web form lists a graded card; the database only guarantees the
-- details never sit on a raw card, and that what is stored is well formed.
--
-- Grants follow the per-column pattern of 0097/0106: public SELECT, member INSERT.
-- Updates go through `itemOrchestrator` on the service-role client (0072), so there is
-- no member UPDATE grant.

alter table cardtrade.items
  add column if not exists grader text,
  add column if not exists grade text,
  add column if not exists cert_number text;

alter table cardtrade.items
  drop constraint if exists items_grading_only_when_graded,
  add constraint items_grading_only_when_graded
    check (condition = 'Graded' or (grader is null and grade is null and cert_number is null)),
  drop constraint if exists items_grader_known,
  add constraint items_grader_known
    check (grader is null or grader in ('PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'ACE', 'Other')),
  drop constraint if exists items_grade_length,
  add constraint items_grade_length
    check (grade is null or char_length(grade) between 1 and 20),
  drop constraint if exists items_cert_number_format,
  add constraint items_cert_number_format
    check (cert_number is null or cert_number ~ '^[A-Za-z0-9-]{4,20}$');

comment on column cardtrade.items.grader is 'Grading company for a Graded listing (0129).';
comment on column cardtrade.items.grade is 'Grade as printed on the slab label, e.g. "10" (0129).';
comment on column cardtrade.items.cert_number is 'Slab certification number, checkable with the grader (0129).';

grant select (grader, grade, cert_number) on cardtrade.items to authenticated, anon;
grant insert (grader, grade, cert_number) on cardtrade.items to authenticated;
