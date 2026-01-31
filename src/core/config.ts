// Configuration loader - reads from environment variables

export interface Config {
  anthropic: {
    apiKey: string;
    model: string;
  };
  slack: {
    botToken: string;
    appToken: string;
    signingSecret: string;
    medicalChannelId: string;
  };
  epic: {
    haikuBaseUrl: string;
    fhirBaseUrl: string;
    clientId: string;
    privateKeyPath: string;
  };
  clarity: {
    connectUrl: string;
    apiKey: string;
  };
  agent: {
    physicianName: string;
    physicianNpi: string;
    practiceName: string;
  };
}

function requireEnv(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (!val) {
    throw new Error(`Missing required env var: ${key}. See .env.example`);
  }
  return val;
}

export function loadConfig(): Config {
  return {
    anthropic: {
      apiKey: requireEnv("ANTHROPIC_API_KEY"),
      model: requireEnv("ANTHROPIC_MODEL", "claude-opus-4-5-20251101"),
    },
    slack: {
      botToken: requireEnv("SLACK_BOT_TOKEN"),
      appToken: requireEnv("SLACK_APP_TOKEN"),
      signingSecret: requireEnv("SLACK_SIGNING_SECRET"),
      medicalChannelId: requireEnv("SLACK_MEDICAL_CHANNEL_ID"),
    },
    epic: {
      haikuBaseUrl: requireEnv("EPIC_HAIKU_BASE_URL", "https://placeholder.epic.com"),
      fhirBaseUrl: requireEnv("EPIC_FHIR_BASE_URL", "https://placeholder.epic.com/api/FHIR/R4"),
      clientId: requireEnv("EPIC_CLIENT_ID", "placeholder-client-id"),
      privateKeyPath: requireEnv("EPIC_PRIVATE_KEY_PATH", "./keys/epic-private-key.pem"),
    },
    clarity: {
      connectUrl: requireEnv("CLARITY_CONNECT_URL", "https://placeholder.clarity.com"),
      apiKey: requireEnv("CLARITY_CONNECT_API_KEY", "placeholder-api-key"),
    },
    agent: {
      physicianName: requireEnv("AGENT_PHYSICIAN_NAME", "Dr. OpenClaw"),
      physicianNpi: requireEnv("AGENT_PHYSICIAN_NPI", "0000000000"),
      practiceName: requireEnv("AGENT_PRACTICE_NAME", "OpenClaw Medical"),
    },
  };
}
