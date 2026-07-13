-- Story 9.1b: the pdccws_p session-cookie auth path is deleted. Its setting
-- rows are unreachable by any code but still hold a real PSN session cookie at
-- rest in a deployed D1 — drop them.
DELETE FROM `setting` WHERE `key` = 'psn_cookie';