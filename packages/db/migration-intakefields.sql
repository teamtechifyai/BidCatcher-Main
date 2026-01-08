-- Update Test Client Config with intakeFields
-- Run this in Supabase SQL Editor

UPDATE clients
SET config = '{
  "version": "1.0",
  "clientId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  "clientName": "Test Construction Co",
  "active": true,
  "intake": {
    "intakeFields": [
      {"key": "projectName", "label": "Project Name", "type": "text", "required": true, "placeholder": "Enter project name"},
      {"key": "senderEmail", "label": "Your Email", "type": "text", "required": true, "placeholder": "your@email.com"},
      {"key": "senderName", "label": "Your Name", "type": "text", "required": false, "placeholder": "Full name"},
      {"key": "senderCompany", "label": "Company", "type": "text", "required": false, "placeholder": "Company name"},
      {"key": "projectLocation", "label": "Project Location", "type": "text", "required": false, "placeholder": "City, State"},
      {"key": "estimatedValue", "label": "Estimated Value ($)", "type": "number", "required": false},
      {"key": "bidDueDate", "label": "Bid Due Date", "type": "date", "required": false},
      {"key": "projectType", "label": "Project Type", "type": "select", "required": false, "options": ["Commercial", "Residential", "Industrial", "Government", "Healthcare", "Education", "Other"]},
      {"key": "bondingRequired", "label": "Bonding Required?", "type": "boolean", "required": false},
      {"key": "preQualified", "label": "Pre-Qualified with GC?", "type": "boolean", "required": false},
      {"key": "notes", "label": "Additional Notes", "type": "textarea", "required": false, "placeholder": "Any additional information about this bid invitation..."}
    ],
    "requiredFields": ["projectName", "senderEmail"],
    "allowedEmailDomains": [],
    "sendAcknowledgement": true
  },
  "pdfExtraction": {
    "signals": [
      {"signalId": "project_name", "label": "Project Name", "required": true},
      {"signalId": "bid_due_date", "label": "Bid Due Date", "required": true},
      {"signalId": "project_location", "label": "Project Location", "required": false},
      {"signalId": "project_value", "label": "Estimated Project Value", "required": false},
      {"signalId": "gc_name", "label": "General Contractor", "required": false},
      {"signalId": "project_type", "label": "Project Type", "required": false}
    ],
    "enableOcr": true,
    "maxPages": 100
  },
  "scoring": {
    "criteria": [
      {
        "criterionId": "has_project_name",
        "name": "Project Name Available",
        "type": "boolean",
        "weight": 1,
        "maxPoints": 10,
        "dependsOnSignals": ["project_name"],
        "rules": [{"condition": "exists", "signal": "project_name", "points": 10}]
      },
      {
        "criterionId": "has_due_date",
        "name": "Due Date Specified",
        "type": "boolean",
        "weight": 1.5,
        "maxPoints": 15,
        "dependsOnSignals": ["bid_due_date"],
        "rules": [{"condition": "exists", "signal": "bid_due_date", "points": 15}]
      },
      {
        "criterionId": "project_in_service_area",
        "name": "Project in Service Area",
        "type": "boolean",
        "weight": 2,
        "maxPoints": 15
      }
    ],
    "autoQualifyThreshold": 75,
    "autoDisqualifyThreshold": 25,
    "alwaysRequireReview": false
  },
  "jobTread": {
    "enabled": false,
    "fieldMappings": [],
    "autoPush": false
  },
  "notifications": {
    "newBidEmails": [],
    "reviewNeededEmails": []
  }
}'::jsonb,
updated_at = now()
WHERE id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

SELECT 'Client config updated with intakeFields!' as status;


