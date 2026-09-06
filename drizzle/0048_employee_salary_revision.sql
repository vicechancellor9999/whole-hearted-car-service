DROP TRIGGER "employee_salary_versions_append_only" ON "employee_salary_versions";
--> statement-breakpoint
CREATE TRIGGER "employee_salary_versions_delete_protected"
BEFORE DELETE ON "employee_salary_versions"
FOR EACH ROW
EXECUTE FUNCTION "reject_master_data_fact_mutation"();
