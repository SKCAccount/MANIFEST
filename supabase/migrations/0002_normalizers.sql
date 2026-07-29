-- 0002_normalizers.sql
-- Immutable normalizers. These must exist before `people`, because the
-- deterministic dedupe keys are generated columns and Postgres requires the
-- generating expression to be IMMUTABLE.
--
-- Normalization has exactly one job here: make two spellings of the same
-- identifier collide on a unique index. It is deliberately conservative — when
-- a value cannot be normalized confidently it is returned trimmed rather than
-- mangled, and v_data_quality surfaces it for the operator to fix by hand.

-- ---------------------------------------------------------------------------
-- Phone → E.164
-- ---------------------------------------------------------------------------
-- The application layer normalizes with libphonenumber-js before the value ever
-- reaches the database; this is the backstop that guarantees the invariant holds
-- for direct SQL, imports and sync jobs. Assumes NANP when a bare 10-digit
-- number arrives, which is correct for this operator's network.

create or replace function fn_normalize_phone(raw text, default_cc text default '1')
returns text
language plpgsql
immutable
as $$
declare
  cleaned text;
  digits  text;
begin
  if raw is null or btrim(raw) = '' then
    return null;
  end if;

  -- Drop a trailing extension ("x22", "ext. 105") before touching the number.
  cleaned := regexp_replace(btrim(raw), '\s*(x|ext\.?|extension)\s*[0-9]+\s*$', '', 'i');

  -- Already well-formed E.164.
  if cleaned ~ '^\+[1-9][0-9]{6,14}$' then
    return cleaned;
  end if;

  digits := regexp_replace(cleaned, '[^0-9+]', '', 'g');
  -- A '+' is only meaningful in the leading position.
  digits := left(digits, 1) || replace(right(digits, greatest(length(digits) - 1, 0)), '+', '');

  if digits ~ '^\+[1-9][0-9]{6,14}$' then
    return digits;
  elsif digits ~ '^011[0-9]{7,14}$' then          -- US international prefix
    return '+' || substring(digits from 4);
  elsif digits ~ '^00[0-9]{7,14}$' then           -- ITU international prefix
    return '+' || substring(digits from 3);
  elsif digits ~ '^1[0-9]{10}$' and default_cc = '1' then
    return '+' || digits;
  elsif digits ~ '^[0-9]{10}$' and default_cc = '1' then
    return '+1' || digits;
  end if;

  -- Unrecognized. Keep the operator's text verbatim and let v_data_quality
  -- flag it rather than silently inventing a country code.
  return btrim(raw);
end;
$$;

comment on function fn_normalize_phone(text, text) is
  'Best-effort E.164 normalization. Returns the trimmed input unchanged when the shape is unrecognized; v_data_quality reports those.';

-- ---------------------------------------------------------------------------
-- LinkedIn URL → dedupe key
-- ---------------------------------------------------------------------------
-- linkedin.com/in/adrienne-delisio, https://www.linkedin.com/in/adrienne-delisio/,
-- and https://uk.linkedin.com/in/adrienne-delisio?originalSubdomain=uk all
-- collapse to the same key.

create or replace function fn_normalize_linkedin(raw text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
begin
  if raw is null or btrim(raw) = '' then
    return null;
  end if;

  v := lower(btrim(raw));
  v := regexp_replace(v, '^https?://', '');            -- protocol
  v := regexp_replace(v, '[?#].*$', '');               -- query string / fragment
  v := regexp_replace(v, '^([a-z0-9-]+\.)*linkedin\.com/', 'linkedin.com/');
  v := regexp_replace(v, '/+$', '');                   -- trailing slash
  v := regexp_replace(v, '^/+', '');                   -- leading slash on bare paths

  -- Bare slug ("in/adrienne-delisio" or "adrienne-delisio") typed by hand.
  if v !~ '^linkedin\.com/' then
    if v ~ '^(in|pub|company)/' then
      v := 'linkedin.com/' || v;
    elsif v ~ '^[a-z0-9][a-z0-9._-]{2,}$' then
      v := 'linkedin.com/in/' || v;
    else
      return null;
    end if;
  end if;

  return nullif(v, '');
end;
$$;

comment on function fn_normalize_linkedin(text) is
  'Collapses LinkedIn URL spellings to a deterministic dedupe key. Returns null for values that are not recognizably LinkedIn.';

-- ---------------------------------------------------------------------------
-- Name → dedupe key (last resort in the dedupe order, section 7.5)
-- ---------------------------------------------------------------------------

-- Latin-1 folding. The `unaccent` extension is not guaranteed to be present on
-- every Postgres this schema runs against, and the dedupe matcher only needs
-- accent folding. Written as one regexp_replace per letter group rather than a
-- translate() pair, because a translate() pair silently misbehaves if the two
-- strings ever drift out of alignment by a single character.
create or replace function unaccent_lite(raw text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(
                     regexp_replace(
                       regexp_replace(
                         regexp_replace(
                           regexp_replace(lower(coalesce(raw, '')), '[àáâãäåāăą]', 'a', 'g'),
                         '[èéêëēĕėęě]', 'e', 'g'),
                       '[ìíîïĩīĭįı]', 'i', 'g'),
                     '[òóôõöøōŏő]', 'o', 'g'),
                   '[ùúûüũūŭůűų]', 'u', 'g'),
                 '[çćĉċč]', 'c', 'g'),
               '[ñńņň]', 'n', 'g'),
             '[šśŝş]', 's', 'g'),
           '[žźż]', 'z', 'g'),
         '[ýÿŷ]', 'y', 'g');
$$;

create or replace function fn_normalize_name(raw text)
returns text
language sql
immutable
as $$
  select nullif(
    btrim(regexp_replace(unaccent_lite(coalesce(raw, '')), '[^a-z0-9]+', ' ', 'g')),
    ''
  );
$$;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function fn_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
