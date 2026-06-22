
CREATE OR REPLACE FUNCTION public.sanitize_class_module_html(_html text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  s text := COALESCE(_html, '');
  tag text;
  dangerous text[] := ARRAY['script','style','iframe','object','embed','link','meta','form','input','button','svg','math'];
  pattern_pair text;
  pattern_solo text;
  prev_len int;
BEGIN
  IF s = '' THEN RETURN ''; END IF;

  FOREACH tag IN ARRAY dangerous LOOP
    -- Note: POSIX regex (Postgres) treats `\b` as backspace, not word-boundary.
    -- Anchor via `[^>]*>` instead.
    pattern_pair := '<[[:space:]]*' || tag || '[[:space:]>][^<]*<[[:space:]]*/[[:space:]]*' || tag || '[[:space:]]*>';
    pattern_solo := '<[[:space:]]*/?[[:space:]]*' || tag || '[[:space:]>][^>]*>';
    LOOP
      prev_len := length(s);
      s := regexp_replace(s, pattern_pair, '', 'gi');
      EXIT WHEN length(s) = prev_len;
    END LOOP;
    s := regexp_replace(s, pattern_solo, '', 'gi');
    -- Also strip a bare `<tag>` or `</tag>` with no attrs or whitespace before `>`.
    s := regexp_replace(s, '<[[:space:]]*/?[[:space:]]*' || tag || '[[:space:]]*>', '', 'gi');
  END LOOP;

  -- Inline event handlers
  s := regexp_replace(s, '[[:space:]]on[a-z]+[[:space:]]*=[[:space:]]*"[^"]*"', '', 'gi');
  s := regexp_replace(s, E'[[:space:]]on[a-z]+[[:space:]]*=[[:space:]]*''[^'']*''', '', 'gi');
  s := regexp_replace(s, '[[:space:]]on[a-z]+[[:space:]]*=[[:space:]]*[^[:space:]>]+', '', 'gi');

  -- Dangerous URI schemes in href/src
  s := regexp_replace(s, '(href|src|xlink:href)[[:space:]]*=[[:space:]]*"[[:space:]]*(javascript|data|vbscript):[^"]*"', '\1="#"', 'gi');
  s := regexp_replace(s, E'(href|src|xlink:href)[[:space:]]*=[[:space:]]*''[[:space:]]*(javascript|data|vbscript):[^'']*''', '\1=''#''', 'gi');

  -- style attributes
  s := regexp_replace(s, '[[:space:]]style[[:space:]]*=[[:space:]]*"[^"]*"', '', 'gi');
  s := regexp_replace(s, E'[[:space:]]style[[:space:]]*=[[:space:]]*''[^'']*''', '', 'gi');

  RETURN s;
END $$;
