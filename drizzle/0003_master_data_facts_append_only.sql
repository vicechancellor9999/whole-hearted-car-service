CREATE FUNCTION "reject_master_data_fact_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'master data version facts are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "repair_team_retirements_append_only"
BEFORE UPDATE OR DELETE ON "repair_team_retirements"
FOR EACH ROW
EXECUTE FUNCTION "reject_master_data_fact_mutation"();
--> statement-breakpoint
CREATE TRIGGER "staff_team_assignment_versions_append_only"
BEFORE UPDATE OR DELETE ON "staff_team_assignment_versions"
FOR EACH ROW
EXECUTE FUNCTION "reject_master_data_fact_mutation"();
--> statement-breakpoint
CREATE TRIGGER "employee_salary_versions_append_only"
BEFORE UPDATE OR DELETE ON "employee_salary_versions"
FOR EACH ROW
EXECUTE FUNCTION "reject_master_data_fact_mutation"();
--> statement-breakpoint
CREATE TRIGGER "payroll_parameter_versions_append_only"
BEFORE UPDATE OR DELETE ON "payroll_parameter_versions"
FOR EACH ROW
EXECUTE FUNCTION "reject_master_data_fact_mutation"();
