-- Migration: Complete schema for YellowCar Counter Production
-- Target: PostgreSQL 15+
-- Date: 2026-04-22
-- Description: Full schema including users, spottings, friends and notifications

-- Schema
CREATE SCHEMA IF NOT EXISTS yellowcar;

-- Users table
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

-- Spottings table
CREATE TABLE IF NOT EXISTS yellowcar.spottings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES yellowcar.users(id) ON DELETE CASCADE,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    location_name TEXT,
    car_type VARCHAR(50),
    image_url TEXT,
    spotted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User stats table
CREATE TABLE IF NOT EXISTS yellowcar.user_stats (
    user_id INTEGER PRIMARY KEY REFERENCES yellowcar.users(id) ON DELETE CASCADE,
    total_count INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    last_spotted_at TIMESTAMP WITH TIME ZONE
);

-- Stats update function
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

-- Friends table
CREATE TABLE IF NOT EXISTS yellowcar.friends (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES yellowcar.users(id) ON DELETE CASCADE,
    friend_id INTEGER NOT NULL REFERENCES yellowcar.users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, friend_id),
    CHECK (user_id != friend_id)
);

-- Notifications table
CREATE TABLE IF NOT EXISTS yellowcar.notifications (
    id SERIAL PRIMARY KEY,
    recipient_id INTEGER NOT NULL REFERENCES yellowcar.users(id) ON DELETE CASCADE,
    sender_id INTEGER REFERENCES yellowcar.users(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    related_id INTEGER,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_friends_user_id ON yellowcar.friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON yellowcar.friends(friend_id);
CREATE INDEX IF NOT EXISTS idx_friends_status ON yellowcar.friends(status);
CREATE INDEX IF NOT EXISTS idx_friends_user_friend ON yellowcar.friends(user_id, friend_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id ON yellowcar.notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_sender_id ON yellowcar.notifications(sender_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON yellowcar.notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON yellowcar.notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread ON yellowcar.notifications(recipient_id, is_read) WHERE is_read = FALSE;

-- Update timestamp function
CREATE OR REPLACE FUNCTION yellowcar.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-update trigger for friends
CREATE TRIGGER trigger_friends_updated_at
    BEFORE UPDATE ON yellowcar.friends
    FOR EACH ROW
    EXECUTE FUNCTION yellowcar.update_updated_at_column();
