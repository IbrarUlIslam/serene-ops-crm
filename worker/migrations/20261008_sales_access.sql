ALTER TABLE user_visibility ADD COLUMN access_profile TEXT NOT NULL DEFAULT 'contributor' CHECK(access_profile IN ('contributor','sales_associate'));
ALTER TABLE user_visibility ADD COLUMN record_scope TEXT NOT NULL DEFAULT 'assigned' CHECK(record_scope IN ('assigned','all_sales'));
-- No existing account receives new sections, edit grants or all-sales scope.
