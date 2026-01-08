-- Migration: Add AI evaluation columns to go_no_go_decisions
-- Date: 2026-01-03

-- Add evaluation_method column
ALTER TABLE go_no_go_decisions 
ADD COLUMN IF NOT EXISTS evaluation_method VARCHAR(20);

-- Add ai_evaluation JSONB column
ALTER TABLE go_no_go_decisions 
ADD COLUMN IF NOT EXISTS ai_evaluation JSONB;

-- Add content column to bid_documents for storing document data
ALTER TABLE bid_documents 
ADD COLUMN IF NOT EXISTS content TEXT;

-- Comment for documentation
COMMENT ON COLUMN go_no_go_decisions.evaluation_method IS 'Method used: rules, ai, or hybrid';
COMMENT ON COLUMN go_no_go_decisions.ai_evaluation IS 'AI evaluation result including recommendation, confidence, factors, and risk assessment';
COMMENT ON COLUMN bid_documents.content IS 'Base64 encoded document content (for MVP - consider object storage for production)';


