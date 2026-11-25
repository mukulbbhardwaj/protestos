-- Runs once, when the local volume is first created.
CREATE DATABASE app_test OWNER app;
\connect app
CREATE EXTENSION IF NOT EXISTS pg_trgm;
\connect app_test
CREATE EXTENSION IF NOT EXISTS pg_trgm;
