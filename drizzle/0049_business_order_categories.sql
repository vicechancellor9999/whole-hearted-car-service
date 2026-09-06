CREATE TYPE "business_order_category" AS ENUM ('maintenance', 'repair', 'inspection');
--> statement-breakpoint
ALTER TABLE "business_orders"
  ADD COLUMN "categories" "business_order_category"[] DEFAULT '{}'::business_order_category[] NOT NULL;
--> statement-breakpoint
WITH facts AS (
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
)
UPDATE business_orders AS business_order
SET categories = array_remove(ARRAY[
  CASE WHEN facts.text ~ '(保养|机油|滤清器|机滤|空滤|oil[[:space:]]*change|maintenance|routine[[:space:]]*service|tune[- ]?up)'
    THEN 'maintenance'::business_order_category END,
  CASE WHEN facts.text ~ '(维修|修理|更换|换|故障|损坏|漏|异响|水泵|轮胎|repair|replace|fix|fault|broken|leak|noise)'
    THEN 'repair'::business_order_category END,
  CASE WHEN facts.text ~ '(检查|检测|诊断|排查|试车|inspect|diagnos|test|scan)'
    THEN 'inspection'::business_order_category END
]::business_order_category[], NULL::business_order_category)
FROM facts
WHERE facts.id = business_order.id;
--> statement-breakpoint
CREATE INDEX "business_orders_categories_gin_idx"
  ON "business_orders" USING gin ("categories");
