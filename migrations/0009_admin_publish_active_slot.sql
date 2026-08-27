CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_publish_tasks_active_draft
ON admin_publish_tasks(draft_id)
WHERE status IN ('pending', 'publishing', 'github_committed', 'awaiting_deploy', 'reconciliation_required');
