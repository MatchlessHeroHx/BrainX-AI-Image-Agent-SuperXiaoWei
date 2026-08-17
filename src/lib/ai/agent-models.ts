import { DEFAULT_AGENT_MODEL } from "@/lib/ai/google-ai";

export type AgentProviderId = "google-ai-studio" | "deepseek";

export type AgentModelCapability = {
  structuredJson: boolean;
  vision: boolean;
  promptCaching: boolean;
};

export type AgentModelDefinition = {
  id: string;
  aliases?: string[];
  displayName: string;
  providerId: AgentProviderId;
  providerModel: string;
  capabilities: AgentModelCapability;
  /** Internal workflow models stay resolvable without appearing in the user picker. */
  userSelectable?: boolean;
};

export type AgentProviderDefinition = {
  id: AgentProviderId;
  displayName: string;
  models: AgentModelDefinition[];
};

/** DeepSeek remains the default; each request may select another public runtime. */
export const DEFAULT_AGENT_PROVIDER_ID: AgentProviderId = "deepseek";
export const DEFAULT_AGENT_MODEL_ID = "deepseek-v4-pro";

const googleAgentModels: AgentModelDefinition[] = [
  {
    id: DEFAULT_AGENT_MODEL,
    aliases: [DEFAULT_AGENT_MODEL, "gemini-agent"],
    displayName: "Gemini 3.7 Flash",
    providerId: "google-ai-studio",
    providerModel: DEFAULT_AGENT_MODEL,
    capabilities: {
      structuredJson: true,
      vision: true,
      promptCaching: true,
    },
  },
  {
    id: "gemini-3.5-flash",
    aliases: ["Gemini 3.5 Flash", "gemini 3.5 flash", "gemini-flash-agent"],
    displayName: "Gemini 3.5 Flash",
    providerId: "google-ai-studio",
    providerModel: "gemini-3.5-flash",
    capabilities: {
      structuredJson: true,
      vision: true,
      promptCaching: true,
    },
    userSelectable: false,
  },
];

const deepSeekAgentModels: AgentModelDefinition[] = [
  {
    id: "deepseek-v4-pro",
    aliases: ["DeepSeek V4 Pro", "DeepSeek-V4-Pro", "deepseek v4 pro"],
    displayName: "DeepSeek V4 Pro",
    providerId: "deepseek",
    providerModel: "deepseek-v4-pro",
    capabilities: {
      structuredJson: true,
      vision: false,
      promptCaching: false,
    },
  },
];

export const AGENT_PROVIDERS: AgentProviderDefinition[] = [
  {
    id: "google-ai-studio",
    displayName: "Google AI Studio",
    models: googleAgentModels,
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    models: deepSeekAgentModels,
  },
];

const providerById = new Map(AGENT_PROVIDERS.map((provider) => [provider.id, provider]));

const normalizeAgentModelKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const modelKeys = (model: AgentModelDefinition) =>
  [model.id, model.providerModel, ...(model.aliases ?? [])].map(normalizeAgentModelKey);

const agentModelByProviderKey = new Map(
  AGENT_PROVIDERS.flatMap((provider) =>
    provider.models.flatMap((model) =>
      modelKeys(model).map((key) => [`${provider.id}:${key}`, model] as const),
    ),
  ),
);

const agentModelByGlobalKey = new Map(
  AGENT_PROVIDERS.flatMap((provider) =>
    provider.models.flatMap((model) =>
      modelKeys(model).map((key) => [key, { provider, model }] as const),
    ),
  ),
);

export function listAgentProviders() {
  return AGENT_PROVIDERS;
}

export function listUserSelectableAgentProviders(): AgentProviderDefinition[] {
  return AGENT_PROVIDERS.map((provider) => ({
    ...provider,
    models: provider.models.filter((model) => model.userSelectable !== false),
  })).filter((provider) => provider.models.length > 0);
}

export function resolveAgentModelSelection(params: {
  providerId?: string;
  modelId?: string;
}) {
  const fallbackProvider = providerById.get(DEFAULT_AGENT_PROVIDER_ID);

  if (!fallbackProvider) {
    throw new Error(`Default agent provider is not registered: ${DEFAULT_AGENT_PROVIDER_ID}`);
  }

  const providerId = params.providerId?.trim();
  const modelId = params.modelId?.trim();
  const explicitProvider = providerId
    ? providerById.get(providerId as AgentProviderId)
    : undefined;

  if (providerId && !explicitProvider) {
    throw new Error(`Agent provider is not registered: ${providerId}`);
  }

  if (modelId) {
    const normalizedModelId = normalizeAgentModelKey(modelId);

    if (explicitProvider) {
      const model = agentModelByProviderKey.get(`${explicitProvider.id}:${normalizedModelId}`);

      if (!model) {
        throw new Error(
          `Agent model is not registered for ${explicitProvider.displayName}: ${modelId}`,
        );
      }

      return {
        provider: explicitProvider,
        model,
      };
    }

    const globalModel = agentModelByGlobalKey.get(normalizedModelId);

    if (!globalModel) {
      throw new Error(`Agent model is not registered: ${modelId}`);
    }

    return globalModel;
  }

  const provider = explicitProvider ?? fallbackProvider;
  const fallbackModelId =
    provider.id === DEFAULT_AGENT_PROVIDER_ID ? DEFAULT_AGENT_MODEL_ID : provider.models[0]?.id;
  const model =
    (fallbackModelId
      ? agentModelByProviderKey.get(`${provider.id}:${normalizeAgentModelKey(fallbackModelId)}`)
      : undefined) ?? provider.models[0];

  if (!model) {
    throw new Error(`No agent models registered for provider: ${provider.id}`);
  }

  return {
    provider,
    model,
  };
}

export function getConfiguredAgentModelSelection() {
  const providerId = process.env.AGENT_PROVIDER ?? process.env.AGENT_MODEL_PROVIDER;

  return resolveAgentModelSelection({
    providerId,
    modelId: process.env.AGENT_MODEL,
  });
}
