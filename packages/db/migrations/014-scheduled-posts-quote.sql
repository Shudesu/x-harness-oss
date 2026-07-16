-- Add quote tweet support to scheduled posts
ALTER TABLE scheduled_posts ADD COLUMN quote_tweet_id TEXT;
