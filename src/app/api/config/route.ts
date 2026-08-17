import { NextResponse } from "next/server";
import { getRuntimeConfig } from "@/lib/ai/image-generation";
import { getConfiguredAgentHarnessRuntime } from "@/lib/agent/harness/registry";
import { DEFAULT_AGENT_PROVIDER_ID } from "@/lib/ai/agent-models";

export async function GET() {
  const agentHarness = getConfiguredAgentHarnessRuntime();

  return NextResponse.json({
    ok: true,
    runtime: getRuntimeConfig(),
    agentHarness: {
      coreProviderId: DEFAULT_AGENT_PROVIDER_ID,
      providerId: agentHarness.provider.id,
      modelId: agentHarness.model.id,
      configured: agentHarness.adapter.isConfigured(),
    },
    docs: {
      prd: "image-agent-feature.md",
      techSpec: "docs/mvp-tech-spec.md",
    },
  });
}
