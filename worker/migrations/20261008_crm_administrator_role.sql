-- Install the role only. This migration grants it to no account.
INSERT INTO roles(id,code,name,description)
VALUES('role_crm_admin','crm_admin','Administrator','Full CRM workspace and user administration; primary ownership remains protected.')
ON CONFLICT(id) DO NOTHING;
