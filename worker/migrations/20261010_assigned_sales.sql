-- Sales access is assigned-only; administrators retain full access.
UPDATE user_visibility SET record_scope='assigned' WHERE access_profile='sales_associate';
