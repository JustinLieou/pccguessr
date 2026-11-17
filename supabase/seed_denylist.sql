-- PCCguessr: display-name denylist seed.
-- Run in the Supabase SQL editor AFTER migrations 0001-0005 and seed.sql.
-- Safe to re-run (on conflict do nothing).
--
-- How it is used: private.name_denylist is checked case-insensitively inside set_display_name /
-- admin_rename_player. whole_word = false: rejected if the name CONTAINS the term (also with spaces and
-- punctuation removed). whole_word = true: rejected only when the term stands alone, with no letter
-- directly before or after it (so "Dean" and "dean_7" are blocked; "Deandre" and "Modern" are not).
-- Terms are stored lowercase. Keep this list to plain terms.
--
-- Terms were left out on purpose when they would block ordinary words or names
-- (for example "ass", "hell", "dick", "cock", "tit", "cum", "rape", "sex", "kys").

insert into private.name_denylist (term) values
  -- Impersonation: names that could pass as staff, the college, or the system
  ('admin'),
  ('administrator'),
  ('moderator'),
  ('pcci'),
  ('official'),
  ('faculty'),
  ('president'),
  ('system'),

  -- Profanity
  ('fuck'),
  ('fucker'),
  ('motherfucker'),
  ('shit'),
  ('bullshit'),
  ('bitch'),
  ('bastard'),
  ('asshole'),
  ('cunt'),
  ('pussy'),
  ('whore'),
  ('slut'),
  ('wanker'),
  ('dildo'),

  -- Slurs
  ('nigger'),
  ('nigga'),
  ('faggot'),
  ('fagot'),
  ('retard'),
  ('kike'),
  ('chink'),
  ('gook'),
  ('tranny'),
  ('wetback')
on conflict (term) do update set whole_word = false;

-- Whole-word terms (short or common-word terms that would otherwise block ordinary names/words).
insert into private.name_denylist (term, whole_word) values
  ('pcc', true),
  ('dean', true),
  ('staff', true),
  ('support', true),
  ('root', true),
  ('spic', true),
  ('dyke', true)
on conflict (term) do update set whole_word = excluded.whole_word;

-- 'mod' was removed: as a substring it blocks Model, Modern, Commodore. 'moderator' stays above.
delete from private.name_denylist where term = 'mod';
