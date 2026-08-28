DO $$
BEGIN
  CREATE TYPE ui_language AS ENUM ('zh', 'en');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE staff_accounts
  ADD COLUMN IF NOT EXISTS ui_language ui_language NOT NULL DEFAULT 'zh';
