-- Schema for YellowCar Counter (Cerebro Central)
-- Target: PostgreSQL 15+

-- Use a schema for organization in the central hub
CREATE SCHEMA IF NOT EXISTS yellowcar;

-- Users table (Centralized)
CREATE TABLE IF NOT EXISTS yellowcar.users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    country TEXT,
    city TEXT,
    continent TEXT,
    instagram_handle VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migration: add location columns if upgrading from older schema
ALTER TABLE yellowcar.users ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE yellowcar.users ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE yellowcar.users ADD COLUMN IF NOT EXISTS continent TEXT;
ALTER TABLE yellowcar.users ADD COLUMN IF NOT EXISTS instagram_handle TEXT;

-- Spottings table (Yellow car sightings)
CREATE TABLE IF NOT EXISTS yellowcar.spottings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES yellowcar.users(id) ON DELETE CASCADE,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    location_name TEXT,
    car_type VARCHAR(50), -- e.g., 'Sedan', 'Sport', 'Hatchback'
    image_url TEXT,
    spotted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Stats view or table for performance
CREATE TABLE IF NOT EXISTS yellowcar.user_stats (
    user_id INTEGER PRIMARY KEY REFERENCES yellowcar.users(id) ON DELETE CASCADE,
    total_count INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    last_spotted_at TIMESTAMP WITH TIME ZONE
);

-- Functions for auto-updating stats
CREATE OR REPLACE FUNCTION yellowcar.update_stats()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO yellowcar.user_stats (user_id, total_count, last_spotted_at)
    VALUES (NEW.user_id, 1, NEW.spotted_at)
    ON CONFLICT (user_id) DO UPDATE
    SET total_count = yellowcar.user_stats.total_count + 1,
        last_spotted_at = NEW.spotted_at;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_stats
AFTER INSERT ON yellowcar.spottings
FOR EACH ROW
EXECUTE FUNCTION yellowcar.update_stats();
