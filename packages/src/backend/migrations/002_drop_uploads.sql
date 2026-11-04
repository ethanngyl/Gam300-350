-- remove the unused uploads table
-- It was created from the start but never written to or read: a job's photos
-- are listed from its images/ folder (or the job_images table on the VM).
DROP TABLE IF EXISTS uploads;
