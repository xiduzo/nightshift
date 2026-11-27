-- A host_space row that this computer left and that names no Host (made by
-- 20261126093041_host_space_left) is removed. Only a Host of record brings
-- a left Space back. The Space itself stays on this computer, so no Host
-- brings it back: a Host takes a listed Space with no row only when this
-- computer has no Space of that id. Only these rows go: every other row of
-- host_space, and every other table, stays as it is.
DELETE FROM `host_space` WHERE `left_at` IS NOT NULL AND `host_id` = '';
