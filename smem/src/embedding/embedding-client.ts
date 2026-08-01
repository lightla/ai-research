export type EmbeddingProvider = "openai";

export type EmbeddingClient = {
  provider: EmbeddingProvider;
  model: string;
  embed(input: string[]): Promise<number[][]>;
};

export function createEmbeddingClient(options: { provider: EmbeddingProvider; model?: string }): EmbeddingClient {
  switch (options.provider) {
    case "openai":
      return createOpenAIEmbeddingClient({
        model: options.model ?? process.env.SMEM_EMBEDDING_MODEL ?? "text-embedding-3-small"
      });
  }
}

function createOpenAIEmbeddingClient(options: { model: string }): EmbeddingClient {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for OpenAI embeddings.");
  }

  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

  return {
    provider: "openai",
    model: options.model,
    async embed(input: string[]): Promise<number[][]> {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: options.model,
          input
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Embedding request failed (${response.status}): ${body}`);
      }

      const json = (await response.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      return json.data
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);
    }
  };
}
