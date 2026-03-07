UPDATE context_layer
SET definitions = jsonb_set(
    definitions,
    '{workspace_config,voice}',
    jsonb_build_object(
        'persona', 'teammate',
        'ownership_pronoun', 'we',
        'directness', 'direct',
        'detail_level', 'manager',
        'name_entities', true,
        'celebrate_wins', true,
        'surface_uncertainty', true,
        'temporal_awareness', 'both',
        'alert_threshold', COALESCE(definitions->'workspace_config'->'voice'->>'alert_threshold', 'watch_and_act'),
        'framing', COALESCE(definitions->'workspace_config'->'voice'->>'framing', 'balanced')
    ),
    true
)
WHERE definitions->'workspace_config' IS NOT NULL
  AND (definitions->'workspace_config'->'voice' IS NULL OR NOT (definitions->'workspace_config'->'voice' ? 'persona'));
