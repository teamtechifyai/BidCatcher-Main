-- Migration: Add Qualification Intake Form client configuration
-- This matches the "Qualification Intake Form TEMPLATE.xlsx" structure

-- First, create a new client for this form (or update existing)
INSERT INTO "clients" ("id", "name", "slug", "contact_email", "contact_name", "active", "config", "created_at", "updated_at")
VALUES (
  'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  'Qualification Form Client',
  'qualification-form',
  'qualification@example.com',
  'Qualification Manager',
  true,
  '{
    "version": "1.0",
    "clientId": "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
    "clientName": "Qualification Form Client",
    "active": true,
    "intake": {
      "intakeFields": [
        {
          "key": "filledBy",
          "label": "Who filled this form",
          "type": "text",
          "required": true,
          "placeholder": "Your name"
        },
        {
          "key": "dateFilled",
          "label": "Date filled",
          "type": "date",
          "required": true
        },
        {
          "key": "documentLink",
          "label": "Link to doc in Drive / SharePoint",
          "type": "text",
          "required": false,
          "placeholder": "Paste share URL here"
        },
        {
          "key": "merxUrl",
          "label": "URL for Merx etc. data",
          "type": "text",
          "required": false,
          "placeholder": "Paste URL here"
        },
        {
          "key": "clientName",
          "label": "Client name",
          "type": "text",
          "required": true,
          "placeholder": "Enter client name"
        },
        {
          "key": "pastWorkWithClient",
          "label": "Past work with client",
          "type": "select",
          "required": false,
          "options": ["Yes - Extensive", "Yes - Some", "No - New Client", "Unknown"]
        },
        {
          "key": "historyWithClient",
          "label": "History with client",
          "type": "select",
          "required": false,
          "options": ["A - Excellent", "B - Good", "C - Not great but would consider", "D - Likely a no"]
        },
        {
          "key": "approximateJobValue",
          "label": "Approximate value of the job ($)",
          "type": "number",
          "required": true,
          "placeholder": "Enter value as a number"
        },
        {
          "key": "constructionMonths",
          "label": "Approximate number of months under construction",
          "type": "number",
          "required": false,
          "placeholder": "Number of months"
        },
        {
          "key": "sector",
          "label": "Sector",
          "type": "select",
          "required": false,
          "options": ["Public", "Private", "P3", "Non-Profit"]
        },
        {
          "key": "publicSectorType",
          "label": "Type of public sector",
          "type": "select",
          "required": false,
          "options": ["Federal", "Provincial", "Municipal", "Crown Corporation", "Education", "Healthcare", "N/A"]
        },
        {
          "key": "funding",
          "label": "Funding",
          "type": "select",
          "required": false,
          "options": ["Fully Funded", "Partially Funded", "Seeking Funding", "Unknown"]
        },
        {
          "key": "jobType",
          "label": "Job type",
          "type": "select",
          "required": false,
          "options": ["New Construction", "Renovation", "Addition", "Tenant Improvement", "Infrastructure", "Other"]
        },
        {
          "key": "projectDescription",
          "label": "Project description",
          "type": "textarea",
          "required": true,
          "placeholder": "Enter project description/name"
        },
        {
          "key": "projectDescriptionRanking",
          "label": "Ranking of Project description and Job Type",
          "type": "select",
          "required": false,
          "options": ["A - Excellent", "B - Good", "C - Not great but would consider", "D - Likely a no"]
        },
        {
          "key": "projectValueRanking",
          "label": "Project value ranking",
          "type": "select",
          "required": false,
          "options": ["A - Excellent", "B - Good", "C - Not great but would consider", "D - Likely a no"]
        },
        {
          "key": "location",
          "label": "Location",
          "type": "text",
          "required": false,
          "placeholder": "Enter location/address"
        },
        {
          "key": "primeConsultant",
          "label": "Prime consultant (Architect Consultants)",
          "type": "text",
          "required": false,
          "placeholder": "Architect/Consultant name"
        },
        {
          "key": "primeConsultantFactors",
          "label": "Other factors to consider about prime consultants",
          "type": "textarea",
          "required": false,
          "placeholder": "Enter other factors"
        },
        {
          "key": "primeConsultantRanking",
          "label": "Prime consultant ranking",
          "type": "select",
          "required": false,
          "options": ["A - Excellent", "B - Good", "C - Not great but would consider", "D - Likely a no"]
        },
        {
          "key": "walkthroughDate",
          "label": "Walkthrough date",
          "type": "date",
          "required": false
        },
        {
          "key": "walkthroughDetails",
          "label": "Walkthrough details",
          "type": "textarea",
          "required": false,
          "placeholder": "Walkthrough location, PPE, RSVP, access details, etc."
        },
        {
          "key": "inquiryDeadline",
          "label": "Inquiry Deadline",
          "type": "date",
          "required": false
        },
        {
          "key": "rfpSubmissionDueDate",
          "label": "RFP Submission due date",
          "type": "date",
          "required": true
        },
        {
          "key": "preConstructionStartDate",
          "label": "Start date pre-construction",
          "type": "date",
          "required": false
        },
        {
          "key": "preConstructionDuration",
          "label": "Timeline - Total Duration of Pre-Construction",
          "type": "text",
          "required": false,
          "placeholder": "e.g., 3 months"
        },
        {
          "key": "preConstructionFactors",
          "label": "Other factors to consider about the pre-construction timeline",
          "type": "textarea",
          "required": false,
          "placeholder": "Enter other factors"
        },
        {
          "key": "preConstructionRanking",
          "label": "Pre-construction timeline ranking",
          "type": "select",
          "required": false,
          "options": ["A - Excellent", "B - Good", "C - Not great but would consider", "D - Likely a no"]
        },
        {
          "key": "interviewRequired",
          "label": "Is an interview required?",
          "type": "boolean",
          "required": false
        },
        {
          "key": "interviewDate",
          "label": "If an interview is required, what is the interview date?",
          "type": "date",
          "required": false
        },
        {
          "key": "constructionStartDate",
          "label": "Start date construction",
          "type": "date",
          "required": false
        },
        {
          "key": "constructionDuration",
          "label": "Timeline - Total Duration of Construction",
          "type": "text",
          "required": false,
          "placeholder": "e.g., 18 months"
        },
        {
          "key": "constructionFactors",
          "label": "Other factors to consider about the construction timeline",
          "type": "textarea",
          "required": false,
          "placeholder": "Enter other factors"
        },
        {
          "key": "constructionRanking",
          "label": "Construction timeline ranking",
          "type": "select",
          "required": false,
          "options": ["A - Excellent", "B - Good", "C - Not great but would consider", "D - Likely a no"]
        },
        {
          "key": "contractType",
          "label": "Contract type",
          "type": "select",
          "required": false,
          "options": ["Stipulated Sum", "Cost Plus", "GMP", "CM at Risk", "Design-Build", "CCDC 2", "CCDC 5A", "CCDC 5B", "Other"]
        },
        {
          "key": "supplementalConditions",
          "label": "Supplemental conditions",
          "type": "select",
          "required": false,
          "options": ["Standard", "Modified - Minor", "Modified - Major", "Custom", "Unknown"]
        },
        {
          "key": "selfPerformanceWork",
          "label": "Self-performance Work",
          "type": "select",
          "required": false,
          "options": ["Required", "Preferred", "Not Required", "Unknown"]
        },
        {
          "key": "selfPerformanceDetails",
          "label": "What is specified as Self-performance on RFP",
          "type": "textarea",
          "required": false,
          "placeholder": "Enter self-performance requirements"
        },
        {
          "key": "specificationDetails",
          "label": "Specification details (Div 0 & 1 items)",
          "type": "textarea",
          "required": false,
          "placeholder": "Any minor or major items that affect specs on Pre-Con Div 0 & 1 items?"
        },
        {
          "key": "developmentTeam",
          "label": "Development team (Owner''s Representative)",
          "type": "text",
          "required": false
        },
        {
          "key": "developmentTeamFactors",
          "label": "Other factors to consider about Development team",
          "type": "textarea",
          "required": false,
          "placeholder": "Enter other factors"
        },
        {
          "key": "developmentTeamRanking",
          "label": "Development team ranking",
          "type": "select",
          "required": false,
          "options": ["A - Excellent", "B - Good", "C - Not great but would consider", "D - Likely a no"]
        },
        {
          "key": "engineeringTeam",
          "label": "Engineering team (Other Consultants)",
          "type": "text",
          "required": false
        },
        {
          "key": "engineeringTeamFactors",
          "label": "Other factors to consider about consultants",
          "type": "textarea",
          "required": false,
          "placeholder": "Enter other factors"
        },
        {
          "key": "engineeringTeamRanking",
          "label": "Engineering team ranking",
          "type": "select",
          "required": false,
          "options": ["A - Excellent", "B - Good", "C - Not great but would consider", "D - Likely a no"]
        },
        {
          "key": "keyResourceRequirements",
          "label": "Key resource requirements",
          "type": "select",
          "required": false,
          "options": ["Standard Team", "Enhanced Team", "Specialized Resources", "Unknown"]
        },
        {
          "key": "keyResourceDetails",
          "label": "Key Specialized Resource Details",
          "type": "textarea",
          "required": false,
          "placeholder": "# of personnel - PM, Super, PC, etc."
        },
        {
          "key": "resourceRanking",
          "label": "Resource requirements ranking",
          "type": "select",
          "required": false,
          "options": ["A - Excellent", "B - Good", "C - Not great but would consider", "D - Likely a no"]
        },
        {
          "key": "submissionFormat",
          "label": "Submission format",
          "type": "select",
          "required": false,
          "options": ["Electronic Only", "Hard Copy Only", "Both", "Unknown"]
        },
        {
          "key": "twoEnvelopeSubmissionDate",
          "label": "2-Envelope Submission date (For 2 Step Fee Submissions)",
          "type": "date",
          "required": false
        },
        {
          "key": "drawingsAvailable",
          "label": "Are drawings available?",
          "type": "boolean",
          "required": false
        },
        {
          "key": "drawingsLink",
          "label": "Link to drawings",
          "type": "text",
          "required": false,
          "placeholder": "Enter URL"
        },
        {
          "key": "scheduleRequired",
          "label": "Is a schedule required with our bid?",
          "type": "boolean",
          "required": false
        },
        {
          "key": "ccdc11Required",
          "label": "Is a CCDC11 required?",
          "type": "boolean",
          "required": false
        },
        {
          "key": "otherReportsProvided",
          "label": "Are other reports provided? (Geotechnical, technical reports, etc.)",
          "type": "boolean",
          "required": false
        },
        {
          "key": "otherReportsLink",
          "label": "Link to other reports",
          "type": "text",
          "required": false,
          "placeholder": "Enter URL"
        },
        {
          "key": "pageLimitation",
          "label": "Is there a page limitation?",
          "type": "boolean",
          "required": false
        },
        {
          "key": "scoringMatrix",
          "label": "Is there a scoring matrix?",
          "type": "boolean",
          "required": false
        },
        {
          "key": "scoringMatrixLink",
          "label": "Where is scoring matrix specified?",
          "type": "text",
          "required": false,
          "placeholder": "Enter URL or section reference"
        },
        {
          "key": "insuranceAvailable",
          "label": "Is insurance available?",
          "type": "boolean",
          "required": false
        },
        {
          "key": "cmFeePageRequired",
          "label": "Is there a CM fee page to fill in the submission?",
          "type": "boolean",
          "required": false
        },
        {
          "key": "feeDetails",
          "label": "Fee details",
          "type": "textarea",
          "required": false,
          "placeholder": "Fixed CM Fee, Fixed Monthly Fee, General Requirements, etc."
        },
        {
          "key": "otherNotes",
          "label": "Other General Notes",
          "type": "textarea",
          "required": false,
          "placeholder": "Any additional notes or considerations"
        }
      ],
      "requiredFields": ["filledBy", "clientName", "projectDescription", "rfpSubmissionDueDate"],
      "allowedEmailDomains": [],
      "sendAcknowledgement": true
    },
    "pdfExtraction": {
      "signals": [
        {"signalId": "project_name", "label": "Project Name/Description", "required": true},
        {"signalId": "client_name", "label": "Client/Owner Name", "required": true},
        {"signalId": "bid_due_date", "label": "RFP Submission Due Date", "required": true},
        {"signalId": "project_value", "label": "Approximate Job Value", "required": false},
        {"signalId": "location", "label": "Project Location", "required": false},
        {"signalId": "walkthrough_date", "label": "Walkthrough Date", "required": false},
        {"signalId": "construction_start", "label": "Construction Start Date", "required": false},
        {"signalId": "construction_duration", "label": "Construction Duration", "required": false},
        {"signalId": "architect", "label": "Prime Consultant/Architect", "required": false},
        {"signalId": "contract_type", "label": "Contract Type", "required": false},
        {"signalId": "self_performance", "label": "Self-Performance Requirements", "required": false},
        {"signalId": "interview_required", "label": "Interview Required", "required": false}
      ],
      "enableOcr": true,
      "maxPages": 100
    },
    "scoring": {
      "criteria": [
        {"criterionId": "client_history", "name": "Client History", "weight": 2, "type": "range", "maxPoints": 20},
        {"criterionId": "project_value_fit", "name": "Project Value Fit", "weight": 1.5, "type": "range", "maxPoints": 15},
        {"criterionId": "timeline_feasible", "name": "Timeline Feasible", "weight": 1.5, "type": "range", "maxPoints": 15},
        {"criterionId": "location_fit", "name": "Location Fit", "weight": 1, "type": "range", "maxPoints": 10},
        {"criterionId": "consultant_relationship", "name": "Consultant Relationship", "weight": 1, "type": "range", "maxPoints": 10},
        {"criterionId": "resource_availability", "name": "Resource Availability", "weight": 1.5, "type": "range", "maxPoints": 15},
        {"criterionId": "contract_terms", "name": "Contract Terms Acceptable", "weight": 1, "type": "range", "maxPoints": 15}
      ],
      "autoQualifyThreshold": 75,
      "autoDisqualifyThreshold": 30,
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
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  config = EXCLUDED.config,
  updated_at = NOW();

-- Verify the client was created
SELECT id, name, slug FROM clients WHERE slug = 'qualification-form';


