CREATE TABLE IF NOT EXISTS admin_bootstrap_lock (id INTEGER PRIMARY KEY CHECK (id = 1), claimed_at TEXT NOT NULL);
INSERT INTO admin_bootstrap_lock (id, claimed_at) SELECT 1, MIN(created_at) FROM admin_users WHERE NOT EXISTS (SELECT 1 FROM admin_bootstrap_lock) GROUP BY 1 HAVING MIN(created_at) IS NOT NULL;
