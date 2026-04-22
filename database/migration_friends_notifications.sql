-- Migration: Add friends and notifications tables
-- Target: PostgreSQL 15+
-- Date: 2026-04-21
-- Description: Adding tables for friend relationships and real-time notifications

-- Friends table for user relationships
CREATE TABLE IF NOT EXISTS yellowcar.friends (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES yellowcar.users(id) ON DELETE CASCADE,
    friend_id INTEGER NOT NULL REFERENCES yellowcar.users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, rejected
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
    type VARCHAR(50) NOT NULL, -- e.g., 'yellow_car_spotted', 'friend_request', 'achievement'
    related_id INTEGER, -- Optional ID related to the notification (e.g., spotting_id)
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_friends_user_id ON yellowcar.friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON yellowcar.friends(friend_id);
CREATE INDEX IF NOT EXISTS idx_friends_status ON yellowcar.friends(status);
CREATE INDEX IF NOT EXISTS idx_friends_user_friend ON yellowcar.friends(user_id, friend_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id ON yellowcar.notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_sender_id ON yellowcar.notifications(sender_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON yellowcar.notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON yellowcar.notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread ON yellowcar.notifications(recipient_id, is_read) WHERE is_read = FALSE;

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION yellowcar.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at on friends table
CREATE TRIGGER trigger_friends_updated_at
    BEFORE UPDATE ON yellowcar.friends
    FOR EACH ROW
    EXECUTE FUNCTION yellowcar.update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE yellowcar.friends IS 'Stores friend relationships between users';
COMMENT ON TABLE yellowcar.notifications IS 'Stores notifications for users about events like yellow car spottings';
COMMENT ON COLUMN yellowcar.friends.status IS 'Relationship status: pending (awaiting approval), accepted (confirmed friendship), rejected (declined)';
COMMENT ON COLUMN yellowcar.notifications.type IS 'Notification type: yellow_car_spotted, friend_request, friend_accepted, achievement, etc.';
