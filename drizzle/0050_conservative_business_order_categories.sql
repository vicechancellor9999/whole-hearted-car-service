WITH raw_facts AS (
  SELECT business_order.id,
         lower(concat_ws(' ',
           original.content_zh,
           original.content_en,
           string_agg(item.name_zh || ' ' || coalesce(item.name_en, '') || ' '
             || coalesce(item.description_zh, '') || ' ' || coalesce(item.description_en, ''), ' ')
         )) AS text
  FROM business_orders AS business_order
  LEFT JOIN business_order_problem_originals AS original
    ON original.business_order_id = business_order.id
  LEFT JOIN business_order_charge_versions AS charge
    ON charge.business_order_id = business_order.id
   AND charge.version_no = business_order.current_charge_version_no
  LEFT JOIN business_order_charge_items AS item
    ON item.charge_version_id = charge.id
  GROUP BY business_order.id, original.content_zh, original.content_en
), facts AS (
  SELECT id,
         regexp_replace(
           regexp_replace(text, '(不要|不需要|无需|不做|暂不)[^，。；,;\n]*', ' ', 'g'),
           E'(do not|don''t|no need to|without)[^,.;\\n]*', ' ', 'gi'
         ) AS text
  FROM raw_facts
)
UPDATE business_orders AS business_order
SET categories = array_remove(ARRAY[
  CASE WHEN facts.text ~ '(保养|机油|滤清器|机滤|空滤)'
         OR facts.text ~ '(^|[^[:alnum:]_])(oil[[:space:]]*change|maintenance|routine[[:space:]]*service|tune[- ]?up)([^[:alnum:]_]|$)'
    THEN 'maintenance'::business_order_category END,
  CASE WHEN facts.text ~ '(维修|修理|更换|修复|故障|损坏|漏油|漏水|异响)'
         OR facts.text ~ '(^|[^[:alnum:]_])(repair|replace|fix|fault|broken|leak|noise)([^[:alnum:]_]|$)'
    THEN 'repair'::business_order_category END,
  CASE WHEN facts.text ~ '(检查|检测|诊断|排查|试车)'
         OR facts.text ~ '(^|[^[:alnum:]_])(inspect|inspection|diagnose|diagnosis|diagnostic|scan)([^[:alnum:]_]|$)'
    THEN 'inspection'::business_order_category END
]::business_order_category[], NULL::business_order_category)
FROM facts
WHERE facts.id = business_order.id;
