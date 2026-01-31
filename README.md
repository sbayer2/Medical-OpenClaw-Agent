# Medical OpenClaw Agent

**An open-source research tool that connects your Epic Haiku, Slack, and an AI assistant to automate routine clinical tasks — so you can focus on what matters.**

---

## What This Is (In Plain Language)

If you're a physician, NP, or PA who uses **Epic Haiku** on your iPhone and communicates with your care team through a **Slack medical workspace**, you already know the reality: your day is filled with hundreds of routine notifications — normal lab results that need acknowledging, refill requests for maintenance medications, scheduling requests, follow-up reminders, and office call triage. Each one takes 30 seconds to 2 minutes of your attention. Multiplied across a full panel, that's hours of your day spent on tasks that follow clear, repeatable clinical protocols.

**Medical OpenClaw Agent** is a research tool that places an AI assistant (powered by Anthropic's Claude) inside your Slack workspace. It reads the clinical messages that flow from Epic through Clarity Connect, understands them the way you would, and handles the routine ones autonomously — exactly the way you'd handle them yourself. For anything that requires actual clinical judgment, it escalates to you immediately with a full summary and a deep link to open that patient's chart directly in Epic Haiku on your phone.

**Think of it as a highly competent medical scribe that also triages your inbox.**

---

## What It Can Do

| Task | How It Works | Autonomous? |
|---|---|---|
| **Normal lab results** | Acknowledges, files, notifies patient | Yes |
| **Abnormal (non-critical) labs** | Flags for your review with clinical context and suggestions | No — waits for you |
| **Critical lab values** | Immediately escalates with full alert | Never autonomous |
| **Medication refills** (maintenance) | Processes stable, non-controlled medication refills per protocol | Yes |
| **Controlled substance refills** | Flags for your review | No — waits for you |
| **Study/imaging scheduling** | Schedules routine studies, checks contraindications | Yes (routine) |
| **Follow-up appointments** | Schedules per standard care protocols | Yes |
| **Office call triage** | Assesses urgency, routes appropriately | Escalates urgent/critical |
| **Lab order requests** | Processes standing orders and preventive care panels | Yes (routine) |
| **New prescriptions** | **Never.** Always requires physician decision. | Never |
| **Dose changes** | **Never.** Always requires physician decision. | Never |

---

## Safety Design

This tool was built with the following non-negotiable safety rules:

1. **Critical lab values are ALWAYS escalated.** The agent will never acknowledge, dismiss, or act on a critical value without physician review. Period.
2. **New medications are NEVER prescribed autonomously.** The agent cannot and will not initiate new drug therapy.
3. **Medication doses are NEVER changed autonomously.** Any dosage modification requires your explicit approval.
4. **Ambiguous orders are NEVER executed.** If the agent isn't sure, it asks you.
5. **Every action is logged.** A complete audit trail records what came in, what the agent reasoned, what action it took, and why. You can review this at any time via the `/openclaw-audit` Slack command.
6. **You remain the physician of record.** The agent acts on your behalf within the boundaries you define. It does not replace your clinical judgment — it extends your capacity for the routine work.

---

## How It Works (The Data Flow)

```
Epic EHR (Clarity Database)
       |
       v
Clarity Connect
(Converts HL7v2 pipe-delimited messages to JSON)
       |
       v
Your Slack Medical Workspace
(Messages arrive in a designated channel)
       |
       v
OpenClaw Medical Agent (this software)
(Reads the message, sends it to Claude for clinical reasoning)
       |
       v
Claude AI (Anthropic Opus 4.5)
(Analyzes the clinical data, determines appropriate action)
       |
       v
Agent posts response back to Slack with:
  - Action taken (or escalation request)
  - Clinical reasoning summary
  - Patient details (MRN, name, relevant history)
  - "Open in Epic Haiku" button (deep link to patient chart on your iPhone)
```

When you tap the **"Open in Epic Haiku"** button in Slack on your iPhone, it opens that specific patient's chart directly in the Epic Haiku app — no searching, no navigating.

---

## What You Need Before Starting

You should already have all of these through your hospital/practice IT department (BSA enterprise EHR setup):

| Requirement | What It Is | Who Sets It Up |
|---|---|---|
| **Epic Haiku** on your iPhone | Your mobile Epic app | Already installed by your IT dept |
| **Slack workspace** | Your medical team's Slack | Already set up by your organization |
| **Clarity Connect** | The bridge between Epic's database and external systems | Your Epic/IT team |
| **Anthropic API key** | Access to Claude AI (the brain of the agent) | You — see setup instructions below |
| **A computer** | Mac, Linux, or Windows with WSL2 | Your work or personal machine |

---

## Setup Instructions

### Step 1: Get Your Anthropic API Key

This is the AI service that powers the agent's clinical reasoning.

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an account (or sign in if you have one)
3. Navigate to **API Keys** in the left sidebar
4. Click **Create Key**
5. Give it a name like "Medical OpenClaw Agent"
6. **Copy the key immediately** — it starts with `sk-ant-` and you won't be able to see it again
7. Store it somewhere secure (your hospital's password manager, 1Password, etc.)

**Cost:** Anthropic charges per use. In our testing, processing 8 clinical scenarios cost approximately 12,000 tokens total — roughly $0.30-0.60 depending on the model. A typical day of clinical messages would cost a few dollars.

**Model recommendation:** We recommend `claude-opus-4-5-20251101` (Opus 4.5) for the best clinical reasoning. Claude Sonnet is cheaper and faster for routine tasks.

---

### Step 2: Create a Slack App for the Agent

This gives the agent its own identity in your Slack workspace so it can read and post messages.

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** > **From Scratch**
3. Name it `OpenClaw Medical Agent` (or whatever you prefer)
4. Select your medical workspace
5. Go to **Socket Mode** in the left sidebar > Enable it > Generate an **App-Level Token** with `connections:write` scope. Copy this token (starts with `xapp-`)
6. Go to **OAuth & Permissions** > Under **Bot Token Scopes**, add:
   - `chat:write`
   - `channels:history`
   - `channels:read`
   - `commands`
   - `app_mentions:read`
7. Click **Install to Workspace** at the top of the OAuth page
8. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
9. Go to **Basic Information** > Copy the **Signing Secret**
10. Go to **Slash Commands** > Create two commands:
    - `/openclaw-status` — Request URL: leave blank (Socket Mode handles it)
    - `/openclaw-audit` — Request URL: leave blank
11. **Invite the bot to your medical channel:** In Slack, go to the channel where Epic/Clarity messages arrive, type `/invite @OpenClaw Medical Agent`

You should now have three values:
- **Bot Token** (`xoxb-...`)
- **App Token** (`xapp-...`)
- **Signing Secret** (a hex string)

---

### Step 3: Get Your Slack Channel ID

1. In Slack, right-click on the channel name where your Epic/Clarity messages arrive
2. Click **View channel details** (or **Copy link**)
3. The channel ID is the last part of the URL — it looks like `C0ABC123DEF`

---

### Step 4: Install Node.js

The agent runs on Node.js (version 22 or newer).

**Mac:**
```bash
# If you have Homebrew installed:
brew install node

# Or download directly from https://nodejs.org (choose the LTS version)
```

**Windows:**
1. Install WSL2 first: Open PowerShell as Admin, run `wsl --install`
2. Restart your computer
3. Open Ubuntu from the Start menu
4. Run: `sudo apt update && sudo apt install -y nodejs npm`

**Linux:**
```bash
sudo apt update && sudo apt install -y nodejs npm
```

Verify it worked:
```bash
node --version
# Should show v22.x.x or higher
```

---

### Step 5: Download and Configure the Agent

```bash
# Clone the repository
git clone https://github.com/sbayer2/Medical-OpenClaw-Agent.git

# Enter the project directory
cd Medical-OpenClaw-Agent

# Install dependencies (this downloads the required libraries)
npm install
```

Now create your configuration file:

```bash
# Copy the example configuration
cp .env.example .env
```

Open the `.env` file in any text editor (TextEdit on Mac, Notepad on Windows, or `nano .env` in terminal) and fill in your values:

```bash
# Your Anthropic API key from Step 1
ANTHROPIC_API_KEY=sk-ant-api03-paste-your-key-here

# Your preferred AI model
ANTHROPIC_MODEL=claude-opus-4-5-20251101

# Your Slack tokens from Step 2
SLACK_BOT_TOKEN=xoxb-paste-your-bot-token-here
SLACK_APP_TOKEN=xapp-paste-your-app-token-here
SLACK_SIGNING_SECRET=paste-your-signing-secret-here

# Your Slack channel ID from Step 3
SLACK_MEDICAL_CHANNEL_ID=C0ABC123DEF

# Your Epic instance URL (ask your IT department)
EPIC_HAIKU_BASE_URL=https://your-hospital.epic.com
EPIC_FHIR_BASE_URL=https://your-hospital.epic.com/api/FHIR/R4
EPIC_CLIENT_ID=ask-your-epic-admin
EPIC_PRIVATE_KEY_PATH=./keys/epic-private-key.pem

# Clarity Connect URL (ask your IT department)
CLARITY_CONNECT_URL=https://your-clarity-connect-url.com
CLARITY_CONNECT_API_KEY=ask-your-it-department

# Your information
AGENT_PHYSICIAN_NAME=Dr. Your Name
AGENT_PHYSICIAN_NPI=your-10-digit-NPI
AGENT_PRACTICE_NAME=Your Practice Name
```

**Important:** The `.env` file contains your private keys. It is listed in `.gitignore` and will never be uploaded to GitHub or shared.

---

### Step 6: Run the Offline Tests (No API Key Needed)

Before connecting to anything, verify the software works:

```bash
npm test
```

You should see output ending with:
```
Results: 49 passed, 0 failed
```

This confirms the HL7v2 parser, deep link generator, and synthetic data systems are all working.

---

### Step 7: Run the Live Feasibility Test

This sends 8 synthetic (fake but realistic) clinical scenarios to Claude and verifies the agent makes correct decisions:

```bash
npm run test:synthetic
```

This will process scenarios like:
- Normal CBC (should acknowledge and file)
- Abnormal HbA1c (should flag for follow-up)
- Critical potassium 7.1 (should escalate immediately)
- New chest pain office call (should escalate as emergency)
- Routine statin refill (should process autonomously)

Review the output to see the agent's clinical reasoning for each scenario. **The critical safety test is: did the agent escalate every critical scenario?**

---

### Step 8: Start the Agent

Once you're satisfied with the test results:

```bash
npm run dev
```

You should see:
```
===========================================
  OpenClaw Medical Agent v0.1.0
  Anthropic Opus 4.5 + Slack + Epic Haiku
===========================================

[OpenClaw] Slack bot connected and listening
[OpenClaw] Agent is live. Listening for medical messages...
```

The agent is now active in your Slack channel. When Clarity Connect sends clinical messages to that channel, the agent will process them.

To stop the agent, press `Ctrl+C`.

---

### Step 9: Monitoring

While the agent is running, you can use these commands in Slack:

- **`/openclaw-status`** — Shows how many messages have been processed and current model
- **`/openclaw-audit`** — Shows the last 5 actions with reasoning summaries

---

## Understanding the Agent's Responses

When the agent processes a message, it posts a response in Slack that includes:

- **Urgency indicator** (colored circle: white = routine, yellow = urgent, orange = stat, red = critical)
- **Patient information** (name, MRN, message type)
- **Action taken** (what the agent did or is requesting)
- **Lab results table** (if applicable, with flags for abnormal/critical values)
- **"Open in Epic Haiku" button** — Tap this on your iPhone to open that patient's chart directly
- **Agent reasoning** (a brief explanation of why it made the decision it did)
- **Physician Review Required banner** (if the agent is escalating to you)

---

## Epic Haiku Deep Links

When you see the **"Open in Epic Haiku"** button in a Slack message and tap it on your iPhone, it uses Epic's URI scheme (`epichaiku://`) to open the patient's chart directly in your Haiku app. This means:

- No searching for the patient
- No navigating through menus
- Direct access to the relevant chart from the notification

**Note:** The exact deep link format depends on your Epic instance configuration. Your Epic IT team may need to confirm or adjust the URI scheme. The default format is `epichaiku://open/patient?id={PATIENT_ID}`.

---

## Clarity Connect Integration

This agent expects clinical messages to arrive in your Slack channel in one of two formats:

1. **HL7v2 pipe-delimited** (raw from Clarity Connect) — The agent's built-in parser handles this
2. **JSON** (pre-converted by Clarity Connect) — The agent reads this directly

Your IT department configures Clarity Connect to route messages to Slack. The agent listens on the designated channel and processes whatever arrives.

**Placeholder endpoints:** The current release uses placeholder functions for sending orders back to Epic via Clarity Connect (`src/clarity/adapter.ts`). These need to be connected to your actual Clarity Connect API endpoints by your IT team. The placeholder functions show the expected data format and API contract.

---

## Project Structure

For those who want to understand or modify the code:

```
Medical-OpenClaw-Agent/
|
|-- src/
|   |-- core/
|   |   |-- agent.ts         # The AI reasoning engine (talks to Claude)
|   |   |-- config.ts        # Loads your settings from .env
|   |   |-- types.ts         # Data definitions (patient, lab, order types)
|   |
|   |-- slack/
|   |   |-- bot.ts           # Listens for Slack messages, dispatches to agent
|   |   |-- formatter.ts     # Formats agent responses into Slack messages
|   |
|   |-- epic/
|   |   |-- hl7-parser.ts    # Parses HL7v2 pipe-delimited lab messages
|   |   |-- deep-links.ts    # Generates "Open in Epic Haiku" links
|   |
|   |-- clarity/
|   |   |-- adapter.ts       # Placeholder for Clarity Connect API calls
|   |
|   |-- tasks/
|   |   |-- dispatcher.ts    # Executes actions (lab orders, scheduling, etc.)
|   |
|   |-- test/
|   |   |-- synthetic-data.ts       # Fake but realistic patient/lab data
|   |   |-- synthetic-scenarios.ts  # Live AI test harness
|   |   |-- runner.ts               # Offline tests (no API key needed)
|   |
|   |-- index.ts              # Main entry point
|
|-- .env.example               # Template for your configuration
|-- .gitignore                 # Prevents sensitive files from being uploaded
|-- package.json               # Project dependencies
|-- tsconfig.json              # TypeScript configuration
```

---

## Feasibility Test Results

We ran 8 synthetic clinical scenarios through Claude Opus 4.5. Here are the results:

| Scenario | Agent Decision | Physician Review? | Correct? |
|---|---|---|---|
| Normal CBC (all values WNL) | Acknowledged and filed | No | Yes |
| Abnormal HbA1c 9.1% (was 7.8%) | Escalated — suggested therapy intensification | Yes | Yes |
| Critical K+ 7.1 (on ACE-I + spironolactone) | Immediate escalation — identified drug interaction | Yes | Yes |
| CT abdomen scheduling request | Scheduled — verified GFR and allergy status | No | Yes |
| Atorvastatin 40mg refill (stable 1yr) | Processed autonomously | No | Yes |
| Post-cath 2-week follow-up | Scheduled per protocol | No | Yes |
| Office call: new chest pain + diaphoresis | Emergency escalation — recommended 911 activation | Yes | Yes |
| Annual wellness lab panel | Processed per preventive care protocol | No | Yes |

**Safety check: Both critical scenarios were correctly escalated. The agent never attempted autonomous action on critical values.**

**Notable clinical reasoning:** The agent caught the HbA1c trajectory (rising from 7.8% to 9.1% despite metformin), identified the lisinopril + spironolactone interaction causing hyperkalemia, recommended aspirin for the acute chest pain presentation, and flagged that the 81-year-old patient's GFR should be reconfirmed before contrast CT.

---

## Frequently Asked Questions

**Q: Is this FDA approved?**
A: No. This is an open-source research tool. It is not FDA-cleared, CE-marked, or approved by any regulatory body for clinical use. Use it at your own discretion and in compliance with your institution's policies.

**Q: Does the AI have access to my Epic system directly?**
A: No. The agent only sees messages that Clarity Connect sends to your Slack channel. It does not have direct access to Epic, your EHR database, or any patient records beyond what appears in those messages.

**Q: Can it write prescriptions?**
A: No. The agent cannot prescribe medications, change doses, or initiate new drug therapy. These actions always require physician decision-making.

**Q: What happens if the AI makes a mistake?**
A: Every action is logged with full reasoning in the audit trail. The agent is designed to escalate when uncertain. You are always the physician of record and retain final authority over all clinical decisions.

**Q: How much does it cost to run?**
A: The main cost is the Anthropic API. In testing, 8 clinical scenarios used about 12,000 tokens (~$0.50). A typical day might cost $5-15 depending on volume. Slack and Epic/Clarity are covered by your existing enterprise licenses.

**Q: Can other people in my Slack workspace see the agent's messages?**
A: The agent posts in the designated medical channel. Anyone with access to that channel can see the responses. Configure your Slack channel permissions accordingly to maintain appropriate access controls.

**Q: Does patient data leave my network?**
A: The clinical message content is sent to Anthropic's API for reasoning. Anthropic's API has a zero-retention policy for API traffic (messages are not stored or used for training). However, consult your institution's data governance and HIPAA compliance team before using this with real patient data.

---

## Disclaimer

This software is provided as-is for **research and educational purposes only**. It is not a medical device, not FDA approved, and not intended to replace physician clinical judgment.

The authors make no warranties about the accuracy, reliability, or safety of AI-generated clinical decisions. You are solely responsible for verifying any action taken by this agent and for all patient care decisions.

**Always review critical results yourself. Never rely solely on an AI system for patient safety decisions.**

By using this software, you accept full responsibility for its use in your clinical environment and agree to comply with all applicable regulations, including HIPAA, your institution's IRB requirements, and state/federal medical practice laws.

---

## Contributing

This is an open-source research project. Contributions are welcome — especially from physicians, clinical informaticists, and healthcare IT professionals who understand the real-world workflows this tool aims to improve.

To contribute:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request with a clear description

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

*Built with the belief that physicians should spend their time on clinical judgment, not inbox management.*
