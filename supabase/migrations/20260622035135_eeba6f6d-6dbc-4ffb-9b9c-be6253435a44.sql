
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

  -- Strip dangerous tag pairs by name. Use [^<]* (no nested markup) and
  -- loop until stable so adjacent / nested instances all go.
  FOREACH tag IN ARRAY dangerous LOOP
    pattern_pair := '<\s*' || tag || '\b[^>]*>[^<]*<\s*/\s*' || tag || '\s*>';
    pattern_solo := '<\s*/?\s*' || tag || '\b[^>]*/?>';
    LOOP
      prev_len := length(s);
      s := regexp_replace(s, pattern_pair, '', 'gi');
      EXIT WHEN length(s) = prev_len;
    END LOOP;
    -- Strip leftover opening/self-closing/orphan-closing variants.
    s := regexp_replace(s, pattern_solo, '', 'gi');
  END LOOP;

  -- Strip inline event handlers: on*="..." or on*='...' or on*=value.
  s := regexp_replace(s, '\son[a-z]+\s*=\s*"[^"]*"', '', 'gi');
  s := regexp_replace(s, E'\\son[a-z]+\\s*=\\s*''[^'']*''', '', 'gi');
  s := regexp_replace(s, '\son[a-z]+\s*=\s*[^\s>]+', '', 'gi');

  -- Neuter javascript:, data:, vbscript: URIs in href/src/xlink:href.
  s := regexp_replace(s, '(href|src|xlink:href)\s*=\s*"(\s*(javascript|data|vbscript):[^"]*)"', '\1="#"', 'gi');
  s := regexp_replace(s, E'(href|src|xlink:href)\\s*=\\s*''(\\s*(javascript|data|vbscript):[^'']*)''', '\1=''#''', 'gi');

  -- Strip style attributes entirely.
  s := regexp_replace(s, '\sstyle\s*=\s*"[^"]*"', '', 'gi');
  s := regexp_replace(s, E'\\sstyle\\s*=\\s*''[^'']*''', '', 'gi');

  RETURN s;
END $$;
