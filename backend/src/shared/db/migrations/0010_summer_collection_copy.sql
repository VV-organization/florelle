UPDATE "collections"
SET "name" = CASE
  WHEN jsonb_typeof("name") = 'object'
    THEN jsonb_set(
      jsonb_set("name", '{en}', to_jsonb('Summer Collection'::text), true),
      '{ru}',
      to_jsonb('Летняя коллекция'::text),
      true
    )
  ELSE to_jsonb('Summer Collection'::text)
END
WHERE "slug" = 'spring-collection';
