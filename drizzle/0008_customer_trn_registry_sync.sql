INSERT INTO "customer_trn_registry" ("trn", "owner_kind", "owner_id", "registered_at")
SELECT "trn", 'person'::customer_account_kind, "id", "created_at"
FROM "personal_customers"
WHERE "trn" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "customer_trn_registry" ("trn", "owner_kind", "owner_id", "registered_at")
SELECT "trn", 'company'::customer_account_kind, "id", "created_at"
FROM "company_accounts"
WHERE "trn" IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION "sync_customer_trn_registry"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	account_kind customer_account_kind := TG_ARGV[0]::customer_account_kind;
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD.trn IS NOT NULL THEN
			DELETE FROM customer_trn_registry
			WHERE trn = OLD.trn AND owner_kind = account_kind AND owner_id = OLD.id;
		END IF;
		RETURN OLD;
	END IF;

	IF TG_OP = 'UPDATE' AND OLD.trn IS NOT DISTINCT FROM NEW.trn THEN
		RETURN NEW;
	END IF;

	IF TG_OP = 'UPDATE' AND OLD.trn IS NOT NULL THEN
		DELETE FROM customer_trn_registry
		WHERE trn = OLD.trn AND owner_kind = account_kind AND owner_id = OLD.id;
	END IF;

	IF NEW.trn IS NOT NULL THEN
		INSERT INTO customer_trn_registry (trn, owner_kind, owner_id)
		VALUES (NEW.trn, account_kind, NEW.id);
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "personal_customers_trn_registry_sync"
AFTER INSERT OR UPDATE OR DELETE ON "personal_customers"
FOR EACH ROW
EXECUTE FUNCTION "sync_customer_trn_registry"('person');
--> statement-breakpoint
CREATE TRIGGER "company_accounts_trn_registry_sync"
AFTER INSERT OR UPDATE OR DELETE ON "company_accounts"
FOR EACH ROW
EXECUTE FUNCTION "sync_customer_trn_registry"('company');
