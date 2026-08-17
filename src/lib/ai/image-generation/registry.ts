import {
  getConfiguredImageModelSelection,
  listImageProviders,
  resolveImageModelSelection,
  type ImageProviderId,
} from "@/lib/ai/image-models";
import { listUserSelectableAgentProviders } from "@/lib/ai/agent-models";
import {
  getAgentHarnessAdapter,
  getConfiguredAgentHarnessRuntime,
} from "@/lib/agent/harness/registry";
import { geminiImageProvider } from "@/lib/ai/image-generation/providers/gemini";
import { wuyinImageProvider } from "@/lib/ai/image-generation/providers/wuyin";
import { modelsrouterImageProvider } from "@/lib/ai/image-generation/providers/modelsrouter";
import type { ImageProviderAdapter } from "@/lib/ai/image-generation/types";

const providers: Record<ImageProviderId, ImageProviderAdapter> = {
  "google-ai-studio": geminiImageProvider,
  wuyin: wuyinImageProvider,
  modelsrouter: modelsrouterImageProvider,
};

export function getImageProviderAdapter(providerId: ImageProviderId) {
  const provider = providers[providerId];

  if (!provider) {
    throw new Error(`Image provider adapter is not registered: ${providerId}`);
  }

  return provider;
}

export function getConfiguredImageRuntime() {
  return getImageRuntime();
}

export function getImageRuntime(params?: { providerId?: string; modelId?: string }) {
  const selection = params
    ? resolveImageModelSelection({
        providerId: params.providerId,
        modelId: params.modelId,
      })
    : getConfiguredImageModelSelection();
  const adapter = getImageProviderAdapter(selection.provider.id);

  return {
    provider: selection.provider,
    model: selection.model,
    adapter,
  };
}

export const getRuntimeConfig = () => {
  const runtime = getConfiguredImageRuntime();
  const agentRuntime = getConfiguredAgentHarnessRuntime();

  return {
    provider: runtime.provider.displayName,
    imageModel: runtime.model.displayName,
    imageProviderId: runtime.provider.id,
    imageModelId: runtime.model.id,
    imageProviderModel: runtime.model.providerModel,
    imageProviders: listImageProviders().map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      configured: getImageProviderAdapter(provider.id).isConfigured(),
      models: provider.models.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        providerModel: model.providerModel,
        capabilities: model.capabilities,
      })),
    })),
    agentProviderId: agentRuntime.provider.id,
    agentModelId: agentRuntime.model.id,
    agentProviderModel: agentRuntime.model.providerModel,
    agentModel: agentRuntime.model.displayName,
    agentProviders: listUserSelectableAgentProviders().map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      configured: getAgentHarnessAdapter(provider.id).isConfigured(),
      models: provider.models.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        providerModel: model.providerModel,
        capabilities: model.capabilities,
      })),
    })),
    agentApiKeyConfigured: agentRuntime.adapter.isConfigured(),
    apiKeyConfigured: runtime.adapter.isConfigured(),
  };
};
